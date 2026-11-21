import { isDeepStrictEqual } from 'node:util'
import { createError } from 'nuxt/server'
import { and, asc, eq, gt, gte, inArray, isNull, ne, or, sum } from 'drizzle-orm'
import { z } from 'zod'
// Relative, not `hub:db`, so this module also loads in `bun test`.
import * as tables from '../../db/schema'
import { FILE_URL_PATTERN } from '../../../shared/utils/file'
import { type Db, getSetting } from '../core/settings'

const textPartSchema = z.object({ type: z.literal('text'), text: z.string().min(1).max(100_000) })
/** An attachment uploaded with `PUT /chats/:id/files`; never an arbitrary URL, which the server would fetch. */
const filePartSchema = z.object({
	type: z.literal('file'),
	mediaType: z.string().max(100),
	url: z.string().regex(FILE_URL_PATTERN),
	filename: z.string().max(255).optional(),
})

export const userMessageSchema = z.object({
	id: z.string().min(1).max(64),
	role: z.literal('user'),
	parts: z.array(z.discriminatedUnion('type', [textPartSchema, filePartSchema])).min(1).max(20),
})

type UserMessageParts = z.infer<typeof userMessageSchema>['parts']

/**
 * Links a message's attachments to it. Each must have been uploaded by the chat's owner to this chat
 * and not belong to another message, so a message cannot pull in someone else's file.
 */
export async function attachFiles(db: Db, chatId: string, messageId: string, parts: UserMessageParts) {
	const ids = [...new Set(parts.flatMap(part => part.type === 'file' ? [FILE_URL_PATTERN.exec(part.url)![1]!] : []))]
	if (!ids.length) return
	const linked = await db.update(tables.file).set({ messageId }).where(and(
		inArray(tables.file.id, ids),
		eq(tables.file.chatId, chatId),
		inArray(tables.file.ownerId, db.select({ id: tables.chat.userId }).from(tables.chat).where(eq(tables.chat.id, chatId))),
		or(isNull(tables.file.messageId), eq(tables.file.messageId, messageId)),
	)).returning({ id: tables.file.id })
	if (linked.length !== ids.length) throw createError({ status: 400, statusText: 'An attachment was not found' })
}

/**
 * The body of `POST /chats/:id`: one answer from one lane (`chatModelId`). The client sends only the new
 * message, never the history. Submitting a message whose id already exists in the chat joins it (another
 * lane answering the same message) or edits it; see `applyTurnTrigger`.
 */
export const turnRequestSchema = z.discriminatedUnion('trigger', [
	z.object({ trigger: z.literal('submit-message'), message: userMessageSchema, chatModelId: z.uuid() }),
	z.object({ trigger: z.literal('regenerate-message'), messageId: z.string().min(1).optional(), chatModelId: z.uuid() }),
])
export type TurnRequest = z.infer<typeof turnRequestSchema>

/** A chat with the ids of the people it is shared with. Ids that are not UUIDs find nothing. */
export async function findChat(db: Db, id: string | undefined) {
	if (!z.uuid().safeParse(id).success) return undefined
	const [chat] = await db.select().from(tables.chat).where(eq(tables.chat.id, id!))
	if (!chat) return undefined
	const shares = await db.select({ userId: tables.chatShare.userId }).from(tables.chatShare)
		.where(eq(tables.chatShare.chatId, chat.id))
	return { ...chat, sharedWith: shares.map(share => share.userId) }
}

/** The people a chat is shared with, as the share dialog shows them. */
export async function listChatShares(db: Db, chatId: string) {
	return await db.select({
		id: tables.user.id,
		username: tables.user.username,
		name: tables.user.name,
		avatarUrl: tables.user.avatarUrl,
	}).from(tables.chatShare)
		.innerJoin(tables.user, eq(tables.user.id, tables.chatShare.userId))
		.where(eq(tables.chatShare.chatId, chatId))
		.orderBy(asc(tables.chatShare.createdAt))
}

/**
 * A chat's messages in the order they were saved. With a lane, only that lane's thread: every message
 * except the other lanes' answers.
 */
export async function listChatMessages(db: Db, chatId: string, chatModelId?: string) {
	return await db.select({
		id: tables.message.id,
		role: tables.message.role,
		parts: tables.message.parts,
		metadata: tables.message.metadata,
		chatModelId: tables.message.chatModelId,
		createdAt: tables.message.createdAt,
	}).from(tables.message)
		.where(and(
			eq(tables.message.chatId, chatId),
			chatModelId ? or(ne(tables.message.role, 'assistant'), eq(tables.message.chatModelId, chatModelId)) : undefined,
		))
		.orderBy(asc(tables.message.seq))
}

/**
 * Whether a lane's request for an existing user message joins it instead of editing it: the message is the
 * chat's newest user message, it arrives unchanged, and this lane has not answered it yet.
 */
async function joinsMessage(db: Db, chatId: string, chatModelId: string, message: { id: string, seq: number }, parts: UserMessageParts) {
	const [stored] = await db.select({ parts: tables.message.parts }).from(tables.message).where(eq(tables.message.id, message.id))
	if (!stored || !isDeepStrictEqual(stored.parts, parts)) return false
	const later = await db.select({ id: tables.message.id }).from(tables.message).where(and(
		eq(tables.message.chatId, chatId),
		eq(tables.message.role, 'user'),
		gt(tables.message.seq, message.seq),
	)).limit(1)
	const answered = await db.select({ id: tables.message.id }).from(tables.message).where(and(
		eq(tables.message.chatModelId, chatModelId),
		eq(tables.message.parentId, message.id),
	)).limit(1)
	return !later.length && !answered.length
}

/**
 * Applies a turn's trigger before the model is called, in one transaction:
 * - a new message is saved;
 * - a message that another lane saved for the same send is joined (`joinsMessage`): nothing changes;
 * - an edit replaces the message's parts and deletes everything after it;
 * - a regenerate deletes the target assistant message and everything after it, or everything after
 *   a target user message. Without a target it starts from the last message.
 *
 * Returns the id of the user message the answer replies to, and the attachments of the deleted messages,
 * which the caller deletes from storage once this has committed.
 */
export async function applyTurnTrigger(db: Db, chatId: string, request: TurnRequest): Promise<{ parentId: string, removedFileIds: string[] }> {
	return await db.transaction(async (tx) => {
		const rows = await tx.select({ id: tables.message.id, role: tables.message.role, seq: tables.message.seq })
			.from(tables.message)
			.where(eq(tables.message.chatId, chatId))
			.orderBy(asc(tables.message.seq))

		const targetId = request.trigger === 'submit-message' ? request.message.id : request.messageId
		const target = rows.find(row => row.id === targetId)

		if (request.trigger === 'submit-message' && !target) {
			const { id, parts } = request.message
			const [saved] = await tx.insert(tables.message)
				.values({ id, chatId, role: 'user', parts, parentId: rows.at(-1)?.id })
				.onConflictDoNothing()
				.returning({ id: tables.message.id })
			if (!saved) {
				// Another lane's request saved it after `rows` was read, or the id belongs to another chat.
				const [existing] = await tx.select({ chatId: tables.message.chatId, role: tables.message.role, seq: tables.message.seq })
					.from(tables.message).where(eq(tables.message.id, id))
				if (existing?.chatId === chatId && existing.role === 'user' && await joinsMessage(tx, chatId, request.chatModelId, { id, seq: existing.seq }, parts)) {
					return { parentId: id, removedFileIds: [] }
				}
				throw createError({ status: 409, statusText: 'This message id is already in use' })
			}
			await attachFiles(tx, chatId, saved.id, parts)
			return { parentId: saved.id, removedFileIds: [] }
		}
		if (targetId !== undefined && !target) throw createError({ status: 404, statusText: 'Message not found' })
		const pivot = target ?? rows.at(-1)
		if (!pivot) throw createError({ status: 400, statusText: 'There is no message to answer' })
		if (request.trigger === 'submit-message') {
			if (pivot.role !== 'user') throw createError({ status: 400, statusText: 'Only your own messages can be edited' })
			if (await joinsMessage(tx, chatId, request.chatModelId, pivot, request.message.parts)) {
				return { parentId: pivot.id, removedFileIds: [] }
			}
			await tx.update(tables.message).set({ parts: request.message.parts }).where(eq(tables.message.id, pivot.id))
			await attachFiles(tx, chatId, pivot.id, request.message.parts)
		}

		// A user message keeps its place; an assistant message is replaced.
		const keepPivot = pivot.role === 'user'
		const removed = and(
			eq(tables.message.chatId, chatId),
			keepPivot ? gt(tables.message.seq, pivot.seq) : gte(tables.message.seq, pivot.seq),
		)
		const removedFiles = await tx.select({ id: tables.file.id }).from(tables.file)
			.innerJoin(tables.message, eq(tables.file.messageId, tables.message.id))
			.where(removed)
		await tx.delete(tables.message).where(removed)

		const last = keepPivot ? pivot : rows.filter(row => row.seq < pivot.seq).at(-1)
		if (last?.role !== 'user') throw createError({ status: 400, statusText: 'There is no message to answer' })
		return { parentId: last.id, removedFileIds: removedFiles.map(file => file.id) }
	})
}

/**
 * This calendar month's (UTC) spend on the instance key, and the budget it counts against:
 * the member's own budget, else the instance default. `budgetUsd` is `null` when unlimited.
 * Turns on a member's own key and turns of unknown cost do not count.
 */
export async function monthlyBudgetStatus(db: Db, user: { id: string, monthlyBudgetUsd: number | null }, now = new Date()) {
	const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
	const [row] = await db.select({ total: sum(tables.usageEvent.costUsd) }).from(tables.usageEvent).where(and(
		eq(tables.usageEvent.userId, user.id),
		eq(tables.usageEvent.byok, false),
		gte(tables.usageEvent.createdAt, monthStart),
	))
	return {
		spentUsd: Number(row?.total ?? 0),
		budgetUsd: user.monthlyBudgetUsd ?? await getSetting(db, 'defaultMonthlyBudgetUsd'),
		monthStart,
	}
}

/** Answers 402 when a paid call on the instance key would go over the member's monthly budget. */
export async function assertWithinBudget(db: Db, user: { id: string, monthlyBudgetUsd: number | null }, byok: boolean) {
	if (byok) return
	const { spentUsd, budgetUsd } = await monthlyBudgetStatus(db, user)
	if (budgetUsd !== null && spentUsd >= budgetUsd) {
		throw createError({ status: 402, statusText: 'You have used this month\'s budget. Add your own API key in the settings to keep chatting.' })
	}
}
