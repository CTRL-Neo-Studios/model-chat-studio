import { createError } from 'nuxt/server'
import { and, asc, eq, gt, gte, sum } from 'drizzle-orm'
import { z } from 'zod'
// Relative, not `hub:db`, so this module also loads in `bun test`.
import * as tables from '../../db/schema'
import { type Db, getSetting } from '../core/settings'

// ponytail: text only until phase 7 adds file parts that reference uploaded files (never arbitrary URLs).
export const userMessageSchema = z.object({
	id: z.string().min(1).max(64),
	role: z.literal('user'),
	parts: z.array(z.object({ type: z.literal('text'), text: z.string().min(1).max(100_000) })).min(1),
})

/**
 * The body of `POST /chats/:id`. The client sends only the new message, never the history.
 * Submitting a message whose id already exists in the chat is an edit.
 */
export const turnRequestSchema = z.discriminatedUnion('trigger', [
	z.object({ trigger: z.literal('submit-message'), message: userMessageSchema }),
	z.object({ trigger: z.literal('regenerate-message'), messageId: z.string().min(1).optional() }),
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

/** A chat's messages in the order they were saved. */
export async function listChatMessages(db: Db, chatId: string) {
	return await db.select({
		id: tables.message.id,
		role: tables.message.role,
		parts: tables.message.parts,
		metadata: tables.message.metadata,
		createdAt: tables.message.createdAt,
	}).from(tables.message)
		.where(eq(tables.message.chatId, chatId))
		.orderBy(asc(tables.message.seq))
}

/**
 * Applies a turn's trigger before the model is called, in one transaction:
 * - a new message is saved;
 * - an edit replaces the message's parts and deletes everything after it;
 * - a regenerate deletes the target assistant message and everything after it, or everything after
 *   a target user message. Without a target it starts from the last message.
 *
 * Returns the id of the user message the answer replies to.
 */
export async function applyTurnTrigger(db: Db, chatId: string, request: TurnRequest): Promise<string> {
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
			// The id exists in another chat.
			if (!saved) throw createError({ status: 409, statusText: 'This message id is already in use' })
			return saved.id
		}
		if (targetId !== undefined && !target) throw createError({ status: 404, statusText: 'Message not found' })
		const pivot = target ?? rows.at(-1)
		if (!pivot) throw createError({ status: 400, statusText: 'There is no message to answer' })
		if (request.trigger === 'submit-message') {
			if (pivot.role !== 'user') throw createError({ status: 400, statusText: 'Only your own messages can be edited' })
			await tx.update(tables.message).set({ parts: request.message.parts }).where(eq(tables.message.id, pivot.id))
		}

		// A user message keeps its place; an assistant message is replaced.
		const keepPivot = pivot.role === 'user'
		await tx.delete(tables.message).where(and(
			eq(tables.message.chatId, chatId),
			keepPivot ? gt(tables.message.seq, pivot.seq) : gte(tables.message.seq, pivot.seq),
		))

		const last = keepPivot ? pivot : rows.filter(row => row.seq < pivot.seq).at(-1)
		if (last?.role !== 'user') throw createError({ status: 400, statusText: 'There is no message to answer' })
		return last.id
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
