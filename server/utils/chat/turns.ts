import { isDeepStrictEqual } from 'node:util'
import { createError } from 'nuxt/server'
import { and, asc, eq, gt, gte, inArray, isNull, ne, or, sql, sum } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { UIMessage } from 'ai'
import { z } from 'zod'
// Relative, not `hub:db`, so this module also loads in `bun test`.
import * as tables from '../../db/schema'
import type { MessageMetadata } from '../../../shared/utils/chat'
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
/** An "@" pick: a file, note or folder of the chat's project, expanded where it stands on every turn. */
export const referencePartSchema = z.object({
	type: z.literal('data-reference'),
	id: z.string().max(64).optional(),
	data: z.object({ entryId: z.uuid(), name: z.string().max(2000), kind: z.enum(['folder', 'file', 'note']) }),
})

export const userMessageSchema = z.object({
	id: z.string().min(1).max(64),
	role: z.literal('user'),
	parts: z.array(z.discriminatedUnion('type', [textPartSchema, filePartSchema, referencePartSchema])).min(1).max(40),
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
 * message or what to answer again, never the history. Edits and deletions are message routes.
 */
export const turnRequestSchema = z.discriminatedUnion('trigger', [
	z.object({ trigger: z.literal('submit-message'), message: userMessageSchema, chatModelId: z.uuid() }),
	z.object({ trigger: z.literal('regenerate-message'), messageId: z.string().min(1).optional(), chatModelId: z.uuid() }),
])
export type TurnRequest = z.infer<typeof turnRequestSchema>

/** The start of the first user message, for when no title was generated. */
export function fallbackTitle(text: string): string {
	const clean = text.replace(/\s+/g, ' ').trim()
	return clean.length > 60 ? `${clean.slice(0, 59)}…` : clean || 'New chat'
}

/** A chat with the ids of the people it is shared with. Ids that are not UUIDs find nothing. */
export async function findChat(db: Db, id: string | undefined) {
	if (!z.uuid().safeParse(id).success) return undefined
	const [[chat], shares] = await Promise.all([
		db.select().from(tables.chat).where(eq(tables.chat.id, id!)),
		db.select({ userId: tables.chatShare.userId }).from(tables.chatShare).where(eq(tables.chatShare.chatId, id!)),
	])
	if (!chat) return undefined
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

const question = alias(tables.message, 'question')

/**
 * A chat's messages in reading order: each user message in the order saved, followed by its answers. An
 * answer regenerated later still sits under its question. With a lane, only that lane's thread: every user
 * message, and that lane's own answers and summaries.
 */
export async function listChatMessages(db: Db, chatId: string, chatModelId?: string) {
	return await db.select({
		id: tables.message.id,
		role: tables.message.role,
		parts: tables.message.parts,
		metadata: tables.message.metadata,
		chatModelId: tables.message.chatModelId,
		/** For an answer, the user message it answers. */
		parentId: tables.message.parentId,
		createdAt: tables.message.createdAt,
	}).from(tables.message)
		.leftJoin(question, and(eq(tables.message.role, 'assistant'), eq(question.id, tables.message.parentId)))
		.where(and(
			eq(tables.message.chatId, chatId),
			chatModelId ? or(eq(tables.message.role, 'user'), eq(tables.message.chatModelId, chatModelId)) : undefined,
		))
		.orderBy(sql`coalesce(${question.seq}, ${tables.message.seq})`, asc(tables.message.seq))
}

/**
 * Whether a lane's request for an existing user message joins it: the message is in this chat, it is the
 * chat's newest user message, it arrives unchanged, and this lane has not answered it yet.
 */
async function joinsMessage(db: Db, chatId: string, chatModelId: string, id: string, parts: UserMessageParts) {
	const [[stored], later, answered] = await Promise.all([
		db.select({ chatId: tables.message.chatId, role: tables.message.role, parts: tables.message.parts }).from(tables.message).where(eq(tables.message.id, id)),
		db.select({ id: tables.message.id }).from(tables.message).where(and(
			eq(tables.message.chatId, chatId),
			eq(tables.message.role, 'user'),
			gt(tables.message.seq, db.select({ seq: tables.message.seq }).from(tables.message).where(eq(tables.message.id, id))),
		)).limit(1),
		db.select({ id: tables.message.id }).from(tables.message).where(and(
			eq(tables.message.chatModelId, chatModelId),
			eq(tables.message.parentId, id),
		)).limit(1),
	])
	return stored?.chatId === chatId && stored.role === 'user' && isDeepStrictEqual(stored.parts, parts) && !later.length && !answered.length
}

/**
 * Applies a turn's trigger before the model is called and returns the user message the answer replies to.
 * Nothing is deleted: the answer replaces this lane's earlier answer to that message when it is saved
 * (`saveAnswer`), so a failed turn keeps the old one.
 * - `submit-message` saves a new message, or joins one that another lane saved for the same send
 *   (`joinsMessage`). Any other existing id is refused; edits are `PATCH /chats/:id/messages/:id`.
 * - `regenerate-message` answers the target answer's question again, or the target user message, or
 *   without a target the newest user message.
 */
export async function applyTurnTrigger(db: Db, chatId: string, request: TurnRequest): Promise<string> {
	if (request.trigger === 'submit-message') {
		const { id, parts } = request.message
		const save = async (tx: Db) => {
			const [saved] = await tx.insert(tables.message)
				.values({
					id, chatId, role: 'user', parts,
					// The chat's newest message, in the same statement.
					parentId: sql`(select ${tables.message.id} from ${tables.message} where ${tables.message.chatId} = ${chatId} order by ${tables.message.seq} desc limit 1)`,
				})
				.onConflictDoNothing()
				.returning({ id: tables.message.id })
			if (saved) await attachFiles(tx, chatId, saved.id, parts)
			return saved
		}
		// Attachments are linked in the same transaction; a text-only message is one statement.
		const saved = parts.some(part => part.type === 'file') ? await db.transaction(save) : await save(db)
		if (saved) return saved.id
		// Another lane's request saved it first, or the id is taken.
		if (await joinsMessage(db, chatId, request.chatModelId, id, parts)) return id
		throw createError({ status: 409, statusText: 'This message id is already in use' })
	}

	const [target] = request.messageId
		? await db.select().from(tables.message).where(and(eq(tables.message.id, request.messageId), eq(tables.message.chatId, chatId)))
		: await db.select().from(tables.message).where(and(eq(tables.message.chatId, chatId), eq(tables.message.role, 'user')))
				.orderBy(sql`${tables.message.seq} desc`).limit(1)
	if (!target) {
		throw request.messageId
			? createError({ status: 404, statusText: 'Message not found' })
			: createError({ status: 400, statusText: 'There is no message to answer' })
	}
	if (target.role === 'user') return target.id
	if (target.role !== 'assistant' || !target.parentId) throw createError({ status: 400, statusText: 'There is no message to answer' })
	if (target.chatModelId !== request.chatModelId) throw createError({ status: 400, statusText: 'This answer belongs to another model' })
	return target.parentId
}

/** Which attempt a lane's current answer to a user message is: 0 when it has none, 1 for the first answer. */
export async function answerAttempt(db: Db, chatModelId: string, parentId: string) {
	const [previous] = await db.select({ metadata: tables.message.metadata }).from(tables.message).where(and(
		eq(tables.message.role, 'assistant'),
		eq(tables.message.parentId, parentId),
		eq(tables.message.chatModelId, chatModelId),
	)).limit(1)
	return previous ? previous.metadata?.attempt ?? 1 : 0
}

/**
 * Saves a lane's answer to a user message, replacing the lane's earlier answer to it, if any. With
 * `keepPrevious`, an earlier answer stays and the new one is dropped. Returns whether it was saved.
 */
export async function saveAnswer(db: Db, answer: { id: string, chatId: string, parentId: string, chatModelId: string, parts: UIMessage['parts'], metadata: MessageMetadata }, keepPrevious = false) {
	return await db.transaction(async (tx) => {
		const previous = and(
			eq(tables.message.role, 'assistant'),
			eq(tables.message.parentId, answer.parentId),
			eq(tables.message.chatModelId, answer.chatModelId),
		)
		if (keepPrevious && (await tx.select({ id: tables.message.id }).from(tables.message).where(previous).limit(1)).length) return false
		await tx.delete(tables.message).where(previous)
		await tx.insert(tables.message).values({ ...answer, role: 'assistant' })
		return true
	})
}

/** Deletes messages and returns their attachments, which the caller deletes from storage once this has committed. */
async function deleteMessageRows(db: Db, ids: string[]) {
	if (!ids.length) return []
	const files = await db.select({ id: tables.file.id }).from(tables.file).where(inArray(tables.file.messageId, ids))
	await db.delete(tables.message).where(inArray(tables.message.id, ids))
	return files.map(file => file.id)
}

async function findMessage(db: Db, chatId: string, messageId: string) {
	const [message] = await db.select().from(tables.message).where(and(eq(tables.message.id, messageId), eq(tables.message.chatId, chatId)))
	if (!message) throw createError({ status: 404, statusText: 'Message not found' })
	return message
}

/**
 * Replaces a message's text in place; nothing else changes. A user message is replaced whole, unless it has
 * attachments, which the editor cannot show. An answer keeps its reasoning, sources and tool parts, and is
 * marked edited. `dropAfter` (user messages) also deletes the message's answers and everything after it,
 * so it can be answered again.
 *
 * Returns the updated message and the attachments of deleted messages, which the caller deletes from storage.
 */
export async function editMessage(db: Db, chatId: string, messageId: string, edit: { text: string, dropAfter?: boolean }) {
	return await db.transaction(async (tx) => {
		const message = await findMessage(tx, chatId, messageId)
		let parts: UIMessage['parts']
		let metadata = message.metadata
		if (message.role === 'user') {
			if (message.parts.some(part => part.type === 'file')) throw createError({ status: 400, statusText: 'A message with attachments cannot be edited' })
			// Its "@" references stay; the new text may name them or not.
			parts = [{ type: 'text', text: edit.text }, ...message.parts.filter(part => part.type === 'data-reference')]
		}
		else if (message.role === 'assistant' && !edit.dropAfter) {
			const first = message.parts.findIndex(part => part.type === 'text')
			parts = message.parts.filter(part => part.type !== 'text')
			parts.splice(first === -1 ? parts.length : first, 0, { type: 'text', text: edit.text })
			metadata = metadata && { ...metadata, edited: true }
		}
		else {
			throw createError({ status: 400, statusText: 'Only your own messages can be answered again' })
		}

		const [updated] = await tx.update(tables.message).set({ parts, metadata }).where(eq(tables.message.id, message.id))
			.returning({ id: tables.message.id, role: tables.message.role, parts: tables.message.parts, metadata: tables.message.metadata })

		let removedFileIds: string[] = []
		if (edit.dropAfter) {
			const later = await tx.select({ id: tables.message.id }).from(tables.message).where(and(
				eq(tables.message.chatId, chatId),
				ne(tables.message.role, 'assistant'),
				gt(tables.message.seq, message.seq),
			))
			const questions = [message.id, ...later.map(row => row.id)]
			const answers = await tx.select({ id: tables.message.id }).from(tables.message).where(and(
				eq(tables.message.role, 'assistant'),
				inArray(tables.message.parentId, questions),
			))
			removedFileIds = await deleteMessageRows(tx, [...later, ...answers].map(row => row.id))
		}
		return { message: updated!, removedFileIds }
	})
}

/**
 * Deletes one message: an answer alone, or a user message with its answers. Everything else stays.
 * Returns the deleted ids and their attachments, which the caller deletes from storage.
 */
export async function deleteMessage(db: Db, chatId: string, messageId: string) {
	return await db.transaction(async (tx) => {
		const message = await findMessage(tx, chatId, messageId)
		const answers = message.role === 'user'
			? await tx.select({ id: tables.message.id }).from(tables.message)
					.where(and(eq(tables.message.role, 'assistant'), eq(tables.message.parentId, message.id)))
			: []
		const ids = [message.id, ...answers.map(row => row.id)]
		return { ids, removedFileIds: await deleteMessageRows(tx, ids) }
	})
}

/**
 * This calendar month's (UTC) spend on the instance key, and the budget it counts against:
 * the member's own budget, else the instance default. `budgetUsd` is `null` when unlimited.
 * Turns on a member's own key and turns of unknown cost do not count.
 */
export async function monthlyBudgetStatus(db: Db, user: { id: string, monthlyBudgetUsd: number | null }, now = new Date()) {
	const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
	const [[row], defaultBudget] = await Promise.all([
		db.select({ total: sum(tables.usageEvent.costUsd) }).from(tables.usageEvent).where(and(
			eq(tables.usageEvent.userId, user.id),
			eq(tables.usageEvent.byok, false),
			gte(tables.usageEvent.createdAt, monthStart),
		)),
		getSetting(db, 'defaultMonthlyBudgetUsd'),
	])
	return {
		spentUsd: Number(row?.total ?? 0),
		budgetUsd: user.monthlyBudgetUsd ?? defaultBudget,
		monthStart,
	}
}

/** Answers 402 when a paid call on the instance key would go over the member's monthly budget. */
export function assertWithinBudget(status: { spentUsd: number, budgetUsd: number | null }, byok: boolean) {
	if (!byok && status.budgetUsd !== null && status.spentUsd >= status.budgetUsd) {
		throw createError({ status: 402, statusText: 'You have used this month\'s budget. Add your own API key in the settings to keep chatting.' })
	}
}
