import { isDeepStrictEqual } from 'node:util'
import { createError } from 'nuxt/server'
import { and, asc, desc, eq, gte, inArray, isNull, ne, or, sql, sum } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { UIMessage } from 'ai'
import { z } from 'zod'
// Relative, not `hub:db`, so this module also loads in `bun test`.
import * as tables from '../../db/schema'
import type { MessageMetadata } from '../../../shared/utils/chat'
import { FILE_URL_PATTERN } from '../../../shared/utils/file'
import { type Db, getSetting } from '../core/settings'
import { branchEnd, branchesOf, shownThread } from './thread'

const textPartSchema = z.object({ type: z.literal('text'), text: z.string().min(1).max(100_000) })
/** An attachment uploaded with `PUT /chats/:id/files`; never an arbitrary URL, which the server would fetch. */
const filePartSchema = z.object({
	type: z.literal('file'),
	mediaType: z.string().max(100),
	url: z.string().regex(FILE_URL_PATTERN),
	filename: z.string().max(255).optional(),
})
/** An "@" pick: a file, note or folder of a library attached to the chat, expanded where it stands on every turn. */
export const referencePartSchema = z.object({
	type: z.literal('data-reference'),
	id: z.string().max(64).optional(),
	data: z.object({ entryId: z.uuid(), name: z.string().max(2000), kind: z.enum(['folder', 'file', 'note']) }),
})
/** An "@" pick of a participant in a group chat, by name; it chooses who answers (`POST /chats/:id/speakers`). */
export const mentionPartSchema = z.object({
	type: z.literal('data-mention'),
	id: z.string().max(64).optional(),
	data: z.object({ name: z.string().min(1).max(200) }),
})

export const userMessageSchema = z.object({
	id: z.string().min(1).max(64),
	role: z.literal('user'),
	parts: z.array(z.discriminatedUnion('type', [textPartSchema, filePartSchema, referencePartSchema, mentionPartSchema])).min(1).max(40),
})

type UserMessageParts = z.infer<typeof userMessageSchema>['parts']

/**
 * Links a message's attachments to it. Each must have been uploaded to this chat by the message's sender
 * and not belong to another message, so a message cannot pull in someone else's file.
 */
export async function attachFiles(db: Db, chatId: string, messageId: string, parts: UserMessageParts, senderId: string) {
	const ids = [...new Set(parts.flatMap(part => part.type === 'file' ? [FILE_URL_PATTERN.exec(part.url)![1]!] : []))]
	if (!ids.length) return
	const linked = await db.update(tables.file).set({ messageId }).where(and(
		inArray(tables.file.id, ids),
		eq(tables.file.chatId, chatId),
		eq(tables.file.ownerId, senderId),
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

/** A chat with the ids of the people it is shared with, and of those of them who are editors. Ids that are not UUIDs find nothing. */
export async function findChat(db: Db, id: string | undefined) {
	if (!z.uuid().safeParse(id).success) return undefined
	const [[chat], shares] = await Promise.all([
		db.select().from(tables.chat).where(eq(tables.chat.id, id!)),
		db.select({ userId: tables.chatShare.userId, role: tables.chatShare.role }).from(tables.chatShare).where(eq(tables.chatShare.chatId, id!)),
	])
	return chat && { ...chat, sharedWith: shares.map(share => share.userId), editors: shares.flatMap(share => share.role === 'editor' ? [share.userId] : []) }
}

/** The people a chat is shared with and their roles, as the share dialog shows them. */
export async function listChatShares(db: Db, chatId: string) {
	return await db.select({
		id: tables.user.id,
		username: tables.user.username,
		name: tables.user.name,
		avatarUrl: tables.user.avatarUrl,
		role: tables.chatShare.role,
	}).from(tables.chatShare)
		.innerJoin(tables.user, eq(tables.user.id, tables.chatShare.userId))
		.where(eq(tables.chatShare.chatId, chatId))
		.orderBy(asc(tables.chatShare.createdAt))
}

const question = alias(tables.message, 'question')

/** A message as the chat and the turn routes read it. */
const messageColumns = {
	id: tables.message.id,
	role: tables.message.role,
	parts: tables.message.parts,
	metadata: tables.message.metadata,
	chatModelId: tables.message.chatModelId,
	/** For an answer, the user message it answers. */
	parentId: tables.message.parentId,
	createdAt: tables.message.createdAt,
}

/**
 * A chat's messages on every branch, in reading order: each user message in the order saved, followed by its
 * answers. An answer regenerated later still sits under its question. Of an answer's versions, the one shown. With
 * a lane, only that lane's messages: every user message, and that lane's own answers and summaries. `shownThread`
 * picks one branch.
 */
export async function listChatMessages(db: Db, chatId: string, chatModelId?: string) {
	return await db.select(messageColumns).from(tables.message)
		.leftJoin(question, and(eq(tables.message.role, 'assistant'), eq(question.id, tables.message.parentId)))
		.where(and(
			eq(tables.message.chatId, chatId),
			eq(tables.message.active, true),
			chatModelId ? or(eq(tables.message.role, 'user'), eq(tables.message.chatModelId, chatModelId)) : undefined,
		))
		.orderBy(sql`coalesce(${question.seq}, ${tables.message.seq})`, asc(tables.message.seq))
}

/**
 * Whether a lane's request for an existing user message joins it: the message is in this chat, it is the
 * chat's tip, it arrives unchanged, and this lane has not answered it yet.
 */
async function joinsMessage(db: Db, chatId: string, chatModelId: string, id: string, parts: UserMessageParts) {
	const [[stored], tip, answered] = await Promise.all([
		db.select({ chatId: tables.message.chatId, role: tables.message.role, parts: tables.message.parts }).from(tables.message).where(eq(tables.message.id, id)),
		chatTip(db, chatId),
		db.select({ id: tables.message.id }).from(tables.message).where(and(
			eq(tables.message.chatModelId, chatModelId),
			eq(tables.message.parentId, id),
		)).limit(1),
	])
	return stored?.chatId === chatId && stored.role === 'user' && isDeepStrictEqual(stored.parts, parts) && tip === id && !answered.length
}

/** The tip of the branch shown: the chat's `leafId`, else its newest user message; `null` before any. */
export async function chatTip(db: Db, chatId: string, lock = false) {
	const query = db.select({ leafId: tables.chat.leafId }).from(tables.chat).where(eq(tables.chat.id, chatId))
	const [chat] = lock ? await query.for('update') : await query
	if (chat?.leafId) return chat.leafId
	const [newest] = await db.select({ id: tables.message.id }).from(tables.message)
		.where(and(eq(tables.message.chatId, chatId), eq(tables.message.role, 'user')))
		.orderBy(desc(tables.message.seq)).limit(1)
	return newest?.id ?? null
}

/**
 * Applies a turn's trigger before the model is called and returns the user message the answer replies to.
 * Nothing changes yet: the answer becomes the lane's shown version when it is saved (`saveAnswer`), so a failed
 * turn keeps the earlier one.
 * - `submit-message` saves a new message after the chat's tip, as the new tip, sent by `senderId`, or joins one that
 *   another lane saved for the same send (`joinsMessage`). Any other existing id is refused; edits are
 *   `PATCH /chats/:id/messages/:id`.
 * - `regenerate-message` answers the target answer's question again, or the target user message, or
 *   without a target the tip.
 */
export async function applyTurnTrigger(db: Db, chatId: string, request: TurnRequest, senderId: string): Promise<string> {
	if (request.trigger === 'submit-message') {
		const { id, parts } = request.message
		const saved = await db.transaction(async (tx) => {
			// One send at a time per chat, so the message follows the tip it read and becomes the tip.
			const parentId = await chatTip(tx, chatId, true)
			const [saved] = await tx.insert(tables.message)
				.values({ id, chatId, role: 'user', parts, parentId, userId: senderId })
				.onConflictDoNothing()
				.returning({ id: tables.message.id })
			if (!saved) return undefined
			await attachFiles(tx, chatId, saved.id, parts, senderId)
			await tx.update(tables.chat).set({ leafId: saved.id }).where(eq(tables.chat.id, chatId))
			return saved
		})
		if (saved) return saved.id
		// Another lane's request saved it first, or the id is taken.
		if (await joinsMessage(db, chatId, request.chatModelId, id, parts)) return id
		throw createError({ status: 409, statusText: 'This message id is already in use' })
	}

	const tip = request.messageId ? undefined : await chatTip(db, chatId)
	const [target] = request.messageId || tip
		? await db.select().from(tables.message).where(and(eq(tables.message.id, (request.messageId ?? tip)!), eq(tables.message.chatId, chatId)))
		: []
	if (!target) {
		throw request.messageId
			? createError({ status: 404, statusText: 'Message not found' })
			: createError({ status: 400, statusText: 'There is no message to answer' })
	}
	// A `/image` message is the user's own drawing: no model answers it.
	if (target.role === 'user' && target.metadata?.kind === 'image') throw createError({ status: 400, statusText: 'A /image message gets no model answer' })
	if (target.role === 'user') return target.id
	if (target.role !== 'assistant' || !target.parentId) throw createError({ status: 400, statusText: 'There is no message to answer' })
	if (target.chatModelId !== request.chatModelId) throw createError({ status: 400, statusText: 'This answer belongs to another model' })
	return target.parentId
}

/**
 * Which attempt a lane's latest answer to a user message is, over all its versions: 0 when it has none, 1 for the
 * first answer. Deleting the newest version gives its attempt back, as deleting an answer did before versions.
 */
export async function answerAttempt(db: Db, chatModelId: string, parentId: string) {
	const [row] = await db.select({ attempt: sql<number | null>`max(coalesce((${tables.message.metadata}->>'attempt')::int, 1))` }).from(tables.message).where(and(
		eq(tables.message.role, 'assistant'),
		eq(tables.message.parentId, parentId),
		eq(tables.message.chatModelId, chatModelId),
	))
	return row?.attempt ?? 0
}

/**
 * Saves a lane's answer to a user message as the version shown; the lane's earlier answer to it, if any, stays as an
 * earlier version. With `keepPrevious`, an earlier answer stays shown and the new one is dropped. In a group chat
 * (`speaker`), the lane joins the end of the user message's `speakers` unless it is there already. Returns whether
 * it was saved.
 */
export async function saveAnswer(db: Db, answer: { id: string, chatId: string, parentId: string, chatModelId: string, parts: UIMessage['parts'], metadata: MessageMetadata }, keepPrevious = false, speaker = false) {
	return await db.transaction(async (tx) => {
		const shown = and(
			eq(tables.message.role, 'assistant'),
			eq(tables.message.parentId, answer.parentId),
			eq(tables.message.chatModelId, answer.chatModelId),
			eq(tables.message.active, true),
		)
		if (keepPrevious && (await tx.select({ id: tables.message.id }).from(tables.message).where(shown).limit(1)).length) return false
		// ponytail: two regenerates of one answer saved at the same moment: the second fails on the index and is lost.
		await tx.update(tables.message).set({ active: false }).where(shown)
		await tx.insert(tables.message).values({ ...answer, role: 'assistant' })
		if (speaker) {
			const speakers = sql`coalesce(${tables.message.metadata}->'speakers', '[]'::jsonb)`
			await tx.update(tables.message)
				.set({ metadata: sql`jsonb_set(coalesce(${tables.message.metadata}, '{}'::jsonb), '{speakers}', ${speakers} || jsonb_build_array(${answer.chatModelId}::text))` })
				.where(and(eq(tables.message.id, answer.parentId), sql`not ${speakers} @> jsonb_build_array(${answer.chatModelId}::text)`))
		}
		return true
	})
}

/**
 * Saves a `/image` exchange at the tip: the user's message (`/image` and the prompt), then an answer of no lane
 * holding the image as a finished `generate_image` call, both marked `kind: 'image'`. The message becomes the tip
 * and the image file is linked to the answer. Returns both, as the chat lists them.
 */
export async function saveImageExchange(db: Db, input: { chatId: string, senderId: string, prompt: string, aspectRatio?: string, model: string, image: { fileId: string, url: string, mediaType: string, prompt: string } }) {
	const { chatId, senderId, prompt, image } = input
	return await db.transaction(async (tx) => {
		// One send at a time per chat, as for a turn: the message follows the tip it read.
		const parentId = await chatTip(tx, chatId, true)
		const [asked] = await tx.insert(tables.message)
			.values({ id: crypto.randomUUID(), chatId, role: 'user', parentId, userId: senderId, parts: [{ type: 'text', text: `/image ${prompt}` }], metadata: { kind: 'image' } })
			.returning(messageColumns)
		const [drawn] = await tx.insert(tables.message)
			.values({
				id: crypto.randomUUID(),
				chatId,
				role: 'assistant',
				parentId: asked!.id,
				parts: [{ type: 'tool-generate_image', toolCallId: crypto.randomUUID(), state: 'output-available', input: { prompt, ...(input.aspectRatio && { aspectRatio: input.aspectRatio }) }, output: image }],
				metadata: { kind: 'image', model: input.model, lane: { name: 'Image', color: null } },
			})
			.returning(messageColumns)
		await tx.update(tables.file).set({ messageId: drawn!.id }).where(eq(tables.file.id, image.fileId))
		await tx.update(tables.chat).set({ leafId: asked!.id }).where(eq(tables.chat.id, chatId))
		return { asked: asked!, drawn: drawn! }
	})
}

/**
 * Deletes messages and returns their attachments, which the caller deletes from storage once this has committed. A
 * file another message of the chat still names (a branch made from a message with it) stays, linked to that message.
 */
async function deleteMessageRows(db: Db, chatId: string, ids: string[]) {
	if (!ids.length) return []
	const files = await db.select({ id: tables.file.id }).from(tables.file).where(inArray(tables.file.messageId, ids))
	await db.delete(tables.message).where(inArray(tables.message.id, ids))
	const removed: string[] = []
	for (const file of files) {
		const [other] = await db.select({ id: tables.message.id }).from(tables.message)
			.where(and(eq(tables.message.chatId, chatId), sql`${tables.message.parts}::text like ${`%/files/${file.id}%`}`)).limit(1)
		if (other) await db.update(tables.file).set({ messageId: other.id }).where(eq(tables.file.id, file.id))
		else removed.push(file.id)
	}
	return removed
}

/** The user messages and summaries after a message on every branch from it. */
async function descendantsOf(db: Db, chatId: string, messageId: string) {
	const rows = await db.select({ id: tables.message.id, parentId: tables.message.parentId }).from(tables.message)
		.where(and(eq(tables.message.chatId, chatId), ne(tables.message.role, 'assistant')))
	const found: string[] = []
	for (let level = [messageId]; level.length;) {
		level = rows.filter(row => row.parentId && level.includes(row.parentId)).map(row => row.id)
		found.push(...level)
	}
	return found
}

/** Messages after the same one: an answer's question, a branch's place; none for greetings and first messages. */
const sameParent = (parentId: string | null) => parentId ? eq(tables.message.parentId, parentId) : isNull(tables.message.parentId)

async function findMessage(db: Db, chatId: string, messageId: string) {
	const [message] = await db.select().from(tables.message).where(and(eq(tables.message.id, messageId), eq(tables.message.chatId, chatId)))
	if (!message) throw createError({ status: 404, statusText: 'Message not found' })
	return message
}

/** A user message's parts with new text: its attachments, "@" references and mentions stay. */
const withText = (parts: UIMessage['parts'], text: string): UIMessage['parts'] => [{ type: 'text', text }, ...parts.filter(part => part.type !== 'text')]

/**
 * Replaces a message's text in place; nothing else changes. A user message keeps its attachments, "@" references
 * and mentions. An answer keeps its reasoning, sources and tool parts, and is marked edited. Returns the message.
 */
export async function editMessage(db: Db, chatId: string, messageId: string, text: string) {
	const message = await findMessage(db, chatId, messageId)
	let parts: UIMessage['parts']
	let metadata = message.metadata
	if (message.role === 'user') {
		parts = withText(message.parts, text)
	}
	else if (message.role === 'assistant') {
		const first = message.parts.findIndex(part => part.type === 'text')
		parts = message.parts.filter(part => part.type !== 'text')
		parts.splice(first === -1 ? parts.length : first, 0, { type: 'text', text })
		metadata = metadata && { ...metadata, edited: true }
	}
	else {
		throw createError({ status: 400, statusText: 'A summary cannot be edited' })
	}
	const [updated] = await db.update(tables.message).set({ parts, metadata }).where(eq(tables.message.id, message.id))
		.returning({ id: tables.message.id, role: tables.message.role, parts: tables.message.parts, metadata: tables.message.metadata })
	return updated!
}

/**
 * Deletes one message: an answer version alone, or a user message with its answers and their versions; what followed
 * the user message moves up to its parent. With `branch`, a user message goes with everything after it on its
 * branches, and the tip, if it was there, moves to the branch made last at its place, else to its parent. When the
 * deleted answer was the one shown, the lane's newest remaining version is shown (`shown`). Returns the deleted ids
 * and their attachments, which the caller deletes from storage.
 */
export async function deleteMessage(db: Db, chatId: string, messageId: string, branch = false) {
	return await db.transaction(async (tx) => {
		const message = await findMessage(tx, chatId, messageId)
		const later = message.role === 'user' && branch ? await descendantsOf(tx, chatId, message.id) : []
		const answers = message.role === 'user'
			? await tx.select({ id: tables.message.id }).from(tables.message)
					.where(and(eq(tables.message.role, 'assistant'), inArray(tables.message.parentId, [message.id, ...later])))
			: []
		if (message.role === 'user' && !branch) {
			// What followed it on its branches moves up to its parent, and so does the tip.
			await tx.update(tables.message).set({ parentId: message.parentId }).where(and(eq(tables.message.chatId, chatId), ne(tables.message.role, 'assistant'), eq(tables.message.parentId, message.id)))
			await tx.update(tables.chat).set({ leafId: message.parentId }).where(and(eq(tables.chat.id, chatId), eq(tables.chat.leafId, message.id)))
		}
		const ids = [message.id, ...later, ...answers.map(row => row.id)]
		const removedFileIds = await deleteMessageRows(tx, chatId, ids)
		if (branch) {
			// Deleting the tip's message set `leafId` to null.
			const [chat] = await tx.select({ leafId: tables.chat.leafId }).from(tables.chat).where(eq(tables.chat.id, chatId))
			if (!chat?.leafId) await tx.update(tables.chat).set({ leafId: branchEnd(await listUserMessages(tx, chatId), message.parentId) }).where(eq(tables.chat.id, chatId))
		}
		const [next] = message.role === 'assistant' && message.active && message.chatModelId
			? await tx.select({ id: tables.message.id }).from(tables.message)
					.where(and(eq(tables.message.role, 'assistant'), eq(tables.message.chatModelId, message.chatModelId), sameParent(message.parentId)))
					.orderBy(desc(tables.message.seq)).limit(1)
			: []
		const [shown] = next ? await tx.update(tables.message).set({ active: true }).where(eq(tables.message.id, next.id)).returning(messageColumns) : []
		return { ids, removedFileIds, shown }
	})
}

/** A chat's user messages in the order made: the tree's nodes. */
async function listUserMessages(db: Db, chatId: string) {
	return await db.select({ id: tables.message.id, parentId: tables.message.parentId }).from(tables.message)
		.where(and(eq(tables.message.chatId, chatId), eq(tables.message.role, 'user')))
		.orderBy(asc(tables.message.seq))
}

/** Shows the branch through a user message: the tip moves to its end, taking at each step the branch made last. */
export async function showBranch(db: Db, chatId: string, messageId: string) {
	return await db.transaction(async (tx) => {
		const message = await findMessage(tx, chatId, messageId)
		if (message.role !== 'user') throw createError({ status: 400, statusText: 'Only a message of yours starts a branch' })
		const leafId = branchEnd(await listUserMessages(tx, chatId), message.id)
		await tx.update(tables.chat).set({ leafId }).where(eq(tables.chat.id, chatId))
		return leafId
	})
}

/** The branches one message may have at its place. */
export const MAX_BRANCHES = 50

/**
 * What the chat page shows: the branch at the chat's tip, each answer the version shown; for those who may write
 * (`switches`), also every version's id of the answers that have several and every branch's first message of the
 * messages that have several.
 */
export async function chatThread(db: Db, chatId: string, switches: boolean) {
	const [[chat], messages, versions] = await Promise.all([
		db.select({ leafId: tables.chat.leafId }).from(tables.chat).where(eq(tables.chat.id, chatId)),
		listChatMessages(db, chatId),
		switches ? listAnswerVersions(db, chatId) : {} as Record<string, string[]>,
	])
	const shown = shownThread(messages, chat?.leafId ?? null)
	return { messages: shown, versions, branches: switches ? branchesOf(messages, shown) : {} as Record<string, string[]> }
}

/**
 * "Save and resend": a new branch at a user message's place, with the new text and the message's attachments,
 * "@" references and mentions, sent by `senderId`. It becomes the tip; the earlier branch stays. Returns it, as the
 * chat lists it.
 */
export async function branchMessage(db: Db, chatId: string, messageId: string, text: string, senderId: string) {
	return await db.transaction(async (tx) => {
		const message = await findMessage(tx, chatId, messageId)
		if (message.role !== 'user') throw createError({ status: 400, statusText: 'Only your own messages can be answered again' })
		const [siblings] = await tx.select({ count: sql<number>`count(*)::int` }).from(tables.message).where(and(
			eq(tables.message.chatId, chatId),
			eq(tables.message.role, 'user'),
			sameParent(message.parentId),
		))
		if ((siblings?.count ?? 0) >= MAX_BRANCHES) throw createError({ status: 400, statusText: `A message can have at most ${MAX_BRANCHES} branches` })
		const [branch] = await tx.insert(tables.message)
			.values({ id: crypto.randomUUID(), chatId, role: 'user', parentId: message.parentId, userId: senderId, parts: withText(message.parts, text) })
			.returning(messageColumns)
		await tx.update(tables.chat).set({ leafId: branch!.id }).where(eq(tables.chat.id, chatId))
		return branch!
	})
}

/** Shows one version of an answer in place of the lane's other versions. Returns it, as the chat lists it. */
export async function showVersion(db: Db, chatId: string, messageId: string) {
	return await db.transaction(async (tx) => {
		const message = await findMessage(tx, chatId, messageId)
		if (message.role !== 'assistant' || !message.chatModelId) throw createError({ status: 400, statusText: 'Only an answer of a model in this chat has versions' })
		await tx.update(tables.message).set({ active: false }).where(and(
			eq(tables.message.role, 'assistant'),
			sameParent(message.parentId),
			eq(tables.message.chatModelId, message.chatModelId),
			eq(tables.message.active, true),
		))
		const [shown] = await tx.update(tables.message).set({ active: true }).where(eq(tables.message.id, message.id)).returning(messageColumns)
		return shown!
	})
}

/** For each shown answer with earlier versions: every version's id, in the order made. */
export async function listAnswerVersions(db: Db, chatId: string) {
	const answers = await db.select({ id: tables.message.id, parentId: tables.message.parentId, chatModelId: tables.message.chatModelId, active: tables.message.active })
		.from(tables.message)
		.where(and(eq(tables.message.chatId, chatId), eq(tables.message.role, 'assistant')))
		.orderBy(asc(tables.message.seq))
	const byAnswer: Record<string, typeof answers> = {}
	// Answers of removed lanes have lost which lane they were; their earlier versions stay hidden.
	for (const answer of answers) if (answer.chatModelId) (byAnswer[`${answer.parentId}:${answer.chatModelId}`] ??= []).push(answer)
	const versions: Record<string, string[]> = {}
	for (const group of Object.values(byAnswer)) {
		const shown = group.find(answer => answer.active)
		if (shown && group.length > 1) versions[shown.id] = group.map(answer => answer.id)
	}
	return versions
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
