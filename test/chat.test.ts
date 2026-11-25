import { beforeEach, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import type { UIMessage } from 'ai'
import * as schema from '../server/db/schema'
import { chatAbilities, type ChatAccess } from '../shared/abilities/chatAbilities'
import { authorize } from '../server/utils/core/authorize'
import { setSetting } from '../server/utils/core/settings'
import { answerAttempt, applyTurnTrigger, branchMessage, chatThread, deleteMessage, editMessage, listAnswerVersions, listChatMessages, monthlyBudgetStatus, saveAnswer, showBranch, showVersion, type TurnRequest } from '../server/utils/chat/turns'
import { assertLaneLimit, countEnabledLanes } from '../server/utils/chat/lanes'
import { shownThread, threadTo } from '../server/utils/chat/thread'
import { createTestDb, type TestDb } from './db'

let db: TestDb
let userId: string
let chatId: string
let laneA: string
let laneB: string

beforeEach(async () => {
	db = await createTestDb()
	const [user] = await db.insert(schema.user).values({ githubId: 1, username: 'u1' }).returning()
	userId = user!.id
	const [chat] = await db.insert(schema.chat).values({ userId }).returning()
	chatId = chat!.id
	const lanes = await db.insert(schema.chatModel).values([{ chatId, position: 0 }, { chatId, position: 1 }]).returning()
	laneA = lanes[0]!.id
	laneB = lanes[1]!.id
})

const say = (id: string, text = id, chatModelId = laneA): TurnRequest => ({ trigger: 'submit-message', message: { id, role: 'user', parts: [{ type: 'text', text }] }, chatModelId })
const regenerate = (messageId?: string, chatModelId = laneA): TurnRequest => ({ trigger: 'regenerate-message', messageId, chatModelId })

/** Saves an answer the way the turn route does. */
async function answer(id: string, parentId: string, chatModelId = laneA, parts: UIMessage['parts'] = [{ type: 'text', text: id }]) {
	await saveAnswer(db, { id, chatId, parentId, chatModelId, parts, metadata: { platform: 'deepseek', model: 'm' } })
}

async function ids(chatModelId?: string) {
	return (await listChatMessages(db, chatId, chatModelId)).map(message => message.id)
}

test('messages come back in the order they were saved, whatever their ids or timestamps', async () => {
	// Same transaction, so the same `createdAt`; ids that sort the other way.
	await db.transaction(async (tx) => {
		for (const id of ['z', 'a', 'm']) await tx.insert(schema.message).values({ id, chatId, role: 'user', parts: [] })
	})
	expect(await ids()).toEqual(['z', 'a', 'm'])
})

test('a new message is saved and answered; it follows the user message before it', async () => {
	expect(await applyTurnTrigger(db, chatId, say('u1'), userId)).toBe('u1')
	await answer('a1', 'u1')
	expect(await applyTurnTrigger(db, chatId, say('u2'), userId)).toBe('u2')
	const [saved] = await db.select().from(schema.message).where(eq(schema.message.id, 'u2'))
	expect(saved?.parentId).toBe('u1')
	expect(await ids()).toEqual(['u1', 'a1', 'u2'])
})

test('another lane sending the same message joins it: nothing is saved twice or dropped', async () => {
	await applyTurnTrigger(db, chatId, say('u1'), userId)
	await answer('a1', 'u1', laneA)

	expect(await applyTurnTrigger(db, chatId, say('u1', 'u1', laneB), userId)).toBe('u1')
	// Again from lane B, before it has answered (a retry after a failed answer): still a join.
	expect(await applyTurnTrigger(db, chatId, say('u1', 'u1', laneB), userId)).toBe('u1')
	expect(await ids()).toEqual(['u1', 'a1'])
})

test('resending a message that is not a join is refused: it changed, the lane answered it, or a newer message exists', async () => {
	await applyTurnTrigger(db, chatId, say('u1'), userId)
	await answer('a1', 'u1', laneA)
	await expect(applyTurnTrigger(db, chatId, say('u1', 'u1', laneA), userId)).rejects.toMatchObject({ status: 409 })
	await expect(applyTurnTrigger(db, chatId, say('u1', 'changed', laneB), userId)).rejects.toMatchObject({ status: 409 })
	await applyTurnTrigger(db, chatId, say('u2'), userId)
	await expect(applyTurnTrigger(db, chatId, say('u1', 'u1', laneB), userId)).rejects.toMatchObject({ status: 409 })
	// A message id from someone else's chat is not taken over.
	const [other] = await db.insert(schema.chat).values({ userId }).returning()
	await expect(applyTurnTrigger(db, other!.id, say('u1'), userId)).rejects.toMatchObject({ status: 409 })
	expect(await ids()).toEqual(['u1', 'a1', 'u2'])
	expect(await listChatMessages(db, other!.id)).toEqual([])
})

test('regenerating answers the question again; the new answer is shown in place of only that lane\'s answer, under its question', async () => {
	await applyTurnTrigger(db, chatId, say('u1'), userId)
	await answer('a1', 'u1', laneA)
	await answer('b1', 'u1', laneB)
	await applyTurnTrigger(db, chatId, say('u2'), userId)
	await answer('a2', 'u2', laneA)

	expect(await applyTurnTrigger(db, chatId, regenerate('a1'), userId)).toBe('u1')
	// Nothing is deleted until the new answer is saved, so a failed turn keeps the old one.
	expect(await ids()).toEqual(['u1', 'a1', 'b1', 'u2', 'a2'])
	await answer('a1x', 'u1', laneA)
	expect(await ids()).toEqual(['u1', 'b1', 'a1x', 'u2', 'a2'])
	expect(await ids(laneA)).toEqual(['u1', 'a1x', 'u2', 'a2'])

	expect(await applyTurnTrigger(db, chatId, regenerate('u1', laneB), userId)).toBe('u1')
	expect(await applyTurnTrigger(db, chatId, regenerate(), userId)).toBe('u2')
})

test('a regenerated answer keeps its earlier versions; any of them can be shown, and the threads follow', async () => {
	await applyTurnTrigger(db, chatId, say('u1'), userId)
	await answer('a1', 'u1', laneA)
	await answer('b1', 'u1', laneB)
	await applyTurnTrigger(db, chatId, say('u2'), userId)
	await answer('a2', 'u2', laneA)
	await answer('a1x', 'u1', laneA)
	await answer('a1y', 'u1', laneA)

	expect(await listAnswerVersions(db, chatId)).toEqual({ a1y: ['a1', 'a1x', 'a1y'] })
	expect(await ids()).toEqual(['u1', 'b1', 'a1y', 'u2', 'a2'])

	// Showing version 1: it is what the chat and the lane's thread hold from then on; later messages stay.
	expect(await showVersion(db, chatId, 'a1')).toMatchObject({ id: 'a1', parentId: 'u1', chatModelId: laneA, parts: [{ type: 'text', text: 'a1' }] })
	expect(await ids(laneA)).toEqual(['u1', 'a1', 'u2', 'a2'])
	expect(await listAnswerVersions(db, chatId)).toEqual({ a1: ['a1', 'a1x', 'a1y'] })
	await expect(showVersion(db, chatId, 'u1')).rejects.toMatchObject({ status: 400 })

	// Deleting a version that is not shown leaves the shown one; deleting the shown one shows the newest left.
	expect(await deleteMessage(db, chatId, 'a1x')).toMatchObject({ ids: ['a1x'], shown: undefined })
	expect((await deleteMessage(db, chatId, 'a1')).shown).toMatchObject({ id: 'a1y' })
	expect(await ids(laneA)).toEqual(['u1', 'a1y', 'u2', 'a2'])
	expect(await listAnswerVersions(db, chatId)).toEqual({})
	// A user message goes with every version of its answers.
	await answer('a2x', 'u2', laneA)
	expect((await deleteMessage(db, chatId, 'u2')).ids.toSorted()).toEqual(['a2', 'a2x', 'u2'])
})

test('the regenerate cap counts the versions made, whichever is shown', async () => {
	await applyTurnTrigger(db, chatId, say('u1'), userId)
	for (const [id, attempt] of [['a1', 1], ['a1x', 2], ['a1y', 3]] as const) {
		await saveAnswer(db, { id, chatId, parentId: 'u1', chatModelId: laneA, parts: [], metadata: { platform: 'deepseek', model: 'm', attempt } })
	}
	await showVersion(db, chatId, 'a1')
	expect(await answerAttempt(db, laneA, 'u1')).toBe(3)
})

test('greetings are versions of one answer to no message: shown first, switched, and read by their lane only', async () => {
	await db.insert(schema.message).values([
		{ id: 'g1', chatId, role: 'assistant', parentId: null, chatModelId: laneA, active: true, parts: [{ type: 'text', text: 'Hello' }] },
		{ id: 'g2', chatId, role: 'assistant', parentId: null, chatModelId: laneA, active: false, parts: [{ type: 'text', text: 'Welcome back' }] },
	])
	await applyTurnTrigger(db, chatId, say('u1'), userId)
	expect(await ids()).toEqual(['g1', 'u1'])
	expect(await ids(laneB)).toEqual(['u1'])
	expect(await listAnswerVersions(db, chatId)).toEqual({ g1: ['g1', 'g2'] })
	await showVersion(db, chatId, 'g2')
	expect(await ids(laneA)).toEqual(['g2', 'u1'])
	expect((await deleteMessage(db, chatId, 'g2')).shown).toMatchObject({ id: 'g1' })
	// A greeting is not answered again: it answers no message.
	await expect(applyTurnTrigger(db, chatId, regenerate('g1'), userId)).rejects.toMatchObject({ status: 400 })
})

test('a stopped answer can leave the earlier answer in place; a first answer is saved either way', async () => {
	const save = (id: string, parentId: string) => saveAnswer(db, { id, chatId, parentId, chatModelId: laneA, parts: [{ type: 'text', text: id }], metadata: { platform: 'deepseek', model: 'm' } }, true)
	await applyTurnTrigger(db, chatId, say('u1'), userId)
	await answer('a1', 'u1')
	expect(await save('a1x', 'u1')).toBe(false)
	expect(await ids()).toEqual(['u1', 'a1'])

	await applyTurnTrigger(db, chatId, say('u2'), userId)
	expect(await save('a2', 'u2')).toBe(true)
	expect(await ids()).toEqual(['u1', 'a1', 'u2', 'a2'])
})

test('an answer counts its attempts per lane; the lane limit follows the admin setting', async () => {
	await applyTurnTrigger(db, chatId, say('u1'), userId)
	expect(await answerAttempt(db, laneA, 'u1')).toBe(0)
	await answer('a1', 'u1', laneA)
	expect(await answerAttempt(db, laneA, 'u1')).toBe(1)
	await saveAnswer(db, { id: 'a1b', chatId, parentId: 'u1', chatModelId: laneA, parts: [], metadata: { platform: 'deepseek', model: 'm', attempt: 3 } })
	expect(await answerAttempt(db, laneA, 'u1')).toBe(3)
	expect(await answerAttempt(db, laneB, 'u1')).toBe(0)

	expect(await countEnabledLanes(db, chatId)).toBe(2)
	await assertLaneLimit(db, 4)
	await expect(assertLaneLimit(db, 5)).rejects.toMatchObject({ status: 400 })
	await setSetting(db, 'maxChatModels', 2)
	await assertLaneLimit(db, 2)
	await expect(assertLaneLimit(db, 3)).rejects.toMatchObject({ status: 400 })
})

test('a regenerate that does not fit is refused', async () => {
	await expect(applyTurnTrigger(db, chatId, regenerate(), userId)).rejects.toMatchObject({ status: 400 })
	await applyTurnTrigger(db, chatId, say('u1'), userId)
	await answer('b1', 'u1', laneB)
	await expect(applyTurnTrigger(db, chatId, regenerate('b1', laneA), userId)).rejects.toMatchObject({ status: 400 })
	await expect(applyTurnTrigger(db, chatId, regenerate('missing'), userId)).rejects.toMatchObject({ status: 404 })
})

test('a lane sees every user message and only its own answers; a lane added late sees questions without answers', async () => {
	await applyTurnTrigger(db, chatId, say('u1'), userId)
	await applyTurnTrigger(db, chatId, say('u1', 'u1', laneB), userId)
	await answer('a1', 'u1', laneA)
	await answer('b1', 'u1', laneB)
	await applyTurnTrigger(db, chatId, say('u2'), userId)
	await answer('a2', 'u2', laneA)

	expect(await ids()).toEqual(['u1', 'a1', 'b1', 'u2', 'a2'])
	expect(await ids(laneA)).toEqual(['u1', 'a1', 'u2', 'a2'])
	expect(await ids(laneB)).toEqual(['u1', 'b1', 'u2'])
	const [late] = await db.insert(schema.chatModel).values({ chatId, position: 2 }).returning()
	expect(await ids(late!.id)).toEqual(['u1', 'u2'])
})

test('a lane\'s thread holds its own summaries only, where they were made', async () => {
	await applyTurnTrigger(db, chatId, say('u1'), userId)
	await answer('a1', 'u1', laneA)
	await answer('b1', 'u1', laneB)
	await db.insert(schema.message).values([
		{ id: 'sA', chatId, role: 'system', parts: [{ type: 'text', text: 'A so far' }], chatModelId: laneA },
		{ id: 'sB', chatId, role: 'system', parts: [{ type: 'text', text: 'B so far' }], chatModelId: laneB },
	])
	await applyTurnTrigger(db, chatId, say('u2'), userId)

	expect(await ids()).toEqual(['u1', 'a1', 'b1', 'sA', 'sB', 'u2'])
	expect(await ids(laneA)).toEqual(['u1', 'a1', 'sA', 'u2'])
	expect(await ids(laneB)).toEqual(['u1', 'b1', 'sB', 'u2'])
})

test('editing a message changes only its text', async () => {
	await applyTurnTrigger(db, chatId, say('u1'), userId)
	await answer('a1', 'u1')
	await applyTurnTrigger(db, chatId, say('u2'), userId)
	await answer('a2', 'u2')
	await applyTurnTrigger(db, chatId, say('u3'), userId)
	await answer('a3', 'u3')
	// Regenerated last, so saved after everything else, but it answers u1.
	await answer('a1x', 'u1')

	const message = await editMessage(db, chatId, 'u2', 'new')
	expect(message.parts).toEqual([{ type: 'text', text: 'new' }])
	expect(await ids()).toEqual(['u1', 'a1x', 'u2', 'a2', 'u3', 'a3'])
})

test('editing an answer replaces its text, keeps its other parts and marks it edited', async () => {
	await applyTurnTrigger(db, chatId, say('u1'), userId)
	await answer('a1', 'u1', laneA, [
		{ type: 'reasoning', text: 'thinking' },
		{ type: 'text', text: 'old' },
		{ type: 'source-url', sourceId: 's', url: 'https://example.com' },
		{ type: 'text', text: 'more' },
	])
	const message = await editMessage(db, chatId, 'a1', 'new')
	expect(message.parts).toEqual([
		{ type: 'reasoning', text: 'thinking' },
		{ type: 'text', text: 'new' },
		{ type: 'source-url', sourceId: 's', url: 'https://example.com' },
	])
	expect(message.metadata).toMatchObject({ model: 'm', edited: true })
	await expect(editMessage(db, chatId, 'missing', 'x')).rejects.toMatchObject({ status: 404 })
})

test('deleting removes an answer alone, or a user message with its answers', async () => {
	await applyTurnTrigger(db, chatId, say('u1'), userId)
	await answer('a1', 'u1', laneA)
	await answer('b1', 'u1', laneB)
	await applyTurnTrigger(db, chatId, say('u2'), userId)
	await answer('a2', 'u2', laneA)

	expect((await deleteMessage(db, chatId, 'b1')).ids).toEqual(['b1'])
	expect(await ids()).toEqual(['u1', 'a1', 'u2', 'a2'])
	expect((await deleteMessage(db, chatId, 'u1')).ids).toEqual(['u1', 'a1'])
	expect(await ids()).toEqual(['u2', 'a2'])
	const [other] = await db.insert(schema.chat).values({ userId }).returning()
	await expect(deleteMessage(db, other!.id, 'u2')).rejects.toMatchObject({ status: 404 })
})

const tip = async () => (await db.select({ leafId: schema.chat.leafId }).from(schema.chat).where(eq(schema.chat.id, chatId)))[0]!.leafId
const parentOf = async (id: string) => (await db.select({ parentId: schema.message.parentId }).from(schema.message).where(eq(schema.message.id, id)))[0]?.parentId
/** A branch at `parentId`, as "Save and resend" will make it, shown. */
async function branch(id: string, parentId: string, parts: UIMessage['parts'] = [{ type: 'text', text: id }]) {
	await db.insert(schema.message).values({ id, chatId, role: 'user', parts: parts as never, parentId })
	await db.update(schema.chat).set({ leafId: id }).where(eq(schema.chat.id, chatId))
}
const shown = async () => shownThread(await listChatMessages(db, chatId), await tip()).map(message => message.id)

test('a message follows the tip and becomes it; a lane joins only the tip; a regenerate without a target answers the tip', async () => {
	await applyTurnTrigger(db, chatId, say('u1'), userId)
	await answer('a1', 'u1')
	await applyTurnTrigger(db, chatId, say('u2'), userId)
	await branch('u2b', 'u1')
	await applyTurnTrigger(db, chatId, say('u3'), userId)
	expect([await parentOf('u3'), await tip()]).toEqual(['u2b', 'u3'])
	expect(await shown()).toEqual(['u1', 'a1', 'u2b', 'u3'])
	expect(await applyTurnTrigger(db, chatId, regenerate(), userId)).toBe('u3')
	// u2 is on the other branch: not the tip, so not joined.
	await expect(applyTurnTrigger(db, chatId, say('u2', 'u2', laneB), userId)).rejects.toMatchObject({ status: 409 })
	expect(await applyTurnTrigger(db, chatId, say('u3', 'u3', laneB), userId)).toBe('u3')
})

test('deleting a user message in the middle moves what followed up to its parent; deleting the tip moves the tip up', async () => {
	for (const n of [1, 2, 3]) {
		await applyTurnTrigger(db, chatId, say(`u${n}`), userId)
		await answer(`a${n}`, `u${n}`)
	}
	await deleteMessage(db, chatId, 'u2')
	expect([await parentOf('u3'), await tip()]).toEqual(['u1', 'u3'])
	expect(await shown()).toEqual(['u1', 'a1', 'u3', 'a3'])
	await deleteMessage(db, chatId, 'u3')
	expect(await tip()).toBe('u1')
	expect(await shown()).toEqual(['u1', 'a1'])
})

test('"Save and resend" starts a branch with the new text and the attachments; switching and deleting branches move the tip', async () => {
	const [file] = await db.insert(schema.file).values({ ownerId: userId, chatId, blobPath: 'x', mediaType: 'image/png', size: 1 }).returning()
	const image = { type: 'file' as const, mediaType: 'image/png', url: `/api/v1/files/${file!.id}` }
	await applyTurnTrigger(db, chatId, say('u1'), userId)
	await answer('a1', 'u1')
	await applyTurnTrigger(db, chatId, { trigger: 'submit-message', message: { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'old' }, image] }, chatModelId: laneA }, userId)
	await answer('a2', 'u2')
	await applyTurnTrigger(db, chatId, say('u3'), userId)
	await answer('a3', 'u3')

	const u2b = await branchMessage(db, chatId, 'u2', 'new', userId)
	expect(u2b).toMatchObject({ role: 'user', parentId: 'u1', parts: [{ type: 'text', text: 'new' }, image] })
	expect([await tip(), await shown()]).toEqual([u2b.id, ['u1', 'a1', u2b.id]])
	// The model answering the branch reads turn 1 and the new turn 2 only.
	expect(threadTo(await listChatMessages(db, chatId), u2b.id).map(message => message.id)).toEqual(['u1', 'a1', u2b.id])
	expect((await chatThread(db, chatId, true)).branches).toEqual({ [u2b.id]: ['u2', u2b.id] })

	// Back to the earlier branch: to its end, and a new message continues it.
	expect(await showBranch(db, chatId, 'u2')).toBe('u3')
	expect(await shown()).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3'])
	await applyTurnTrigger(db, chatId, say('u4'), userId)
	expect(await parentOf('u4')).toBe('u3')

	// Deleting the branch shown moves the tip to the branch made last at its place; the file stays for u2b.
	const { ids: gone, removedFileIds } = await deleteMessage(db, chatId, 'u2', true)
	expect(gone.toSorted()).toEqual(['a2', 'a3', 'u2', 'u3', 'u4'])
	expect(removedFileIds).toEqual([])
	expect([await tip(), await shown()]).toEqual([u2b.id, ['u1', 'a1', u2b.id]])
	expect((await chatThread(db, chatId, true)).branches).toEqual({})
	await expect(showBranch(db, chatId, 'a1')).rejects.toMatchObject({ status: 400 })
})

test('an attachment stays while another message of the chat still names it', async () => {
	const [file] = await db.insert(schema.file).values({ ownerId: userId, chatId, blobPath: 'x', mediaType: 'image/png', size: 1 }).returning()
	const parts: UIMessage['parts'] = [{ type: 'text', text: 'see' }, { type: 'file', mediaType: 'image/png', url: `/api/v1/files/${file!.id}` }]
	await applyTurnTrigger(db, chatId, { trigger: 'submit-message', message: { id: 'u1', role: 'user', parts: parts as never }, chatModelId: laneA }, userId)
	await answer('a1', 'u1')
	await applyTurnTrigger(db, chatId, say('u2'), userId)
	await branch('u1b', 'u1', parts)
	expect((await deleteMessage(db, chatId, 'u1')).removedFileIds).toEqual([])
	const [linked] = await db.select().from(schema.file).where(eq(schema.file.id, file!.id))
	expect(linked?.messageId).toBe('u1b')
	expect((await deleteMessage(db, chatId, 'u1b')).removedFileIds).toEqual([file!.id])
})

test('attachments link to their message once, only from whoever uploaded them, and are reported when their message is deleted', async () => {
	const [other] = await db.insert(schema.user).values({ githubId: 2, username: 'u2' }).returning()
	const upload = async (ownerId: string) => (await db.insert(schema.file).values({ ownerId, chatId, blobPath: 'x', mediaType: 'image/png', size: 1 }).returning())[0]!.id
	const withFile = (id: string, fileId: string): TurnRequest => ({
		trigger: 'submit-message',
		message: { id, role: 'user', parts: [{ type: 'text', text: 'see' }, { type: 'file', mediaType: 'image/png', url: `/api/v1/files/${fileId}` }] },
		chatModelId: laneA,
	})
	const mine = await upload(userId)
	const theirs = await upload(other!.id)
	await applyTurnTrigger(db, chatId, say('u0'), userId)
	await answer('a0', 'u0')

	await expect(applyTurnTrigger(db, chatId, withFile('u1', theirs), userId)).rejects.toMatchObject({ status: 400 })
	expect(await ids()).toEqual(['u0', 'a0'])

	await applyTurnTrigger(db, chatId, withFile('u1', mine), userId)
	const [linked] = await db.select().from(schema.file).where(eq(schema.file.id, mine))
	expect(linked?.messageId).toBe('u1')
	await answer('a1', 'u1')
	// Someone else taking part (an editor) attaches their own upload, and is the message's sender.
	await applyTurnTrigger(db, chatId, withFile('u2', theirs), other!.id)
	expect((await db.select().from(schema.message).where(eq(schema.message.id, 'u2')))[0]?.userId).toBe(other!.id)
	await answer('a2', 'u2')
	// Already part of u1, so another message cannot take it.
	await expect(applyTurnTrigger(db, chatId, withFile('u3', mine), userId)).rejects.toMatchObject({ status: 400 })
	// Edited text keeps the attachment.
	expect((await editMessage(db, chatId, 'u1', 'x')).parts).toEqual([{ type: 'text', text: 'x' }, { type: 'file', mediaType: 'image/png', url: `/api/v1/files/${mine}` }])

	// Deleting u0's branch drops u1 and u2, and with them their attachments.
	expect((await deleteMessage(db, chatId, 'u0', true)).removedFileIds.toSorted()).toEqual([mine, theirs].toSorted())
})

test('the budget counts this month on the instance key only; a member budget wins over the default', async () => {
	const now = new Date('2026-11-20T12:00:00Z')
	const spend = (costUsd: number | null, createdAt: string, byok = false) =>
		db.insert(schema.usageEvent).values({ userId, chatId, kind: 'chat', platform: 'openrouter', costUsd, byok, createdAt: new Date(createdAt) })
	await spend(0.5, '2026-11-01T00:00:00Z')
	await spend(0.25, '2026-11-19T00:00:00Z')
	await spend(null, '2026-11-19T00:00:00Z')
	await spend(9, '2026-11-19T00:00:00Z', true)
	await spend(9, '2026-10-31T23:59:59Z')

	expect(await monthlyBudgetStatus(db, { id: userId, monthlyBudgetUsd: null }, now)).toMatchObject({ spentUsd: 0.75, budgetUsd: null })
	await setSetting(db, 'defaultMonthlyBudgetUsd', 0.75)
	expect(await monthlyBudgetStatus(db, { id: userId, monthlyBudgetUsd: null }, now)).toMatchObject({ budgetUsd: 0.75 })
	expect(await monthlyBudgetStatus(db, { id: userId, monthlyBudgetUsd: 2 }, now)).toMatchObject({ budgetUsd: 2 })
})

type TestUser = { id: string, role: 'user' | 'moderator' | 'admin', banned: boolean, banExpires: Date | null }
const person = (id: string, role: TestUser['role'] = 'user', banned = false): TestUser => ({ id, role, banned, banExpires: null })

function eventFor(user: TestUser | null) {
	return { context: { $authorization: { resolveServerUser: async () => user } } } as never
}

const owner = person('owner')
const listed = person('listed')
const stranger = person('stranger')
const admin = person('admin', 'admin')
const privateChat: ChatAccess = { userId: 'owner', visibility: 'private', sharedWith: ['listed', 'editor'], editors: ['editor'] }
const linkChat: ChatAccess = { ...privateChat, visibility: 'public' }

const read = (user: TestUser | null, chat?: ChatAccess) => authorize(eventFor(user), chatAbilities().readChat as never, chat as never)
/** What each ability answers: 200 allowed, else the status it is denied with. */
const statuses = (user: TestUser | null, chat: ChatAccess) => Promise.all([chatAbilities().readChat, chatAbilities().writeChat, chatAbilities().manageChat].map(ability =>
	authorize(eventFor(user), ability as never, chat as never).then(() => 200, (error: { status: number }) => error.status)))

test('a private chat is readable by its owner and the people it is shared with; everyone else gets 404', async () => {
	await read(owner, privateChat)
	await read(listed, privateChat)
	for (const user of [stranger, admin, null]) await expect(read(user, privateChat)).rejects.toMatchObject({ status: 404 })
	await expect(read(owner, undefined)).rejects.toMatchObject({ status: 404 })
})

test('link access lets anyone read, guests included', async () => {
	for (const user of [stranger, admin, null]) await read(user, linkChat)
})

// The access table of the milestone 11 plan (section 1): read, write, manage.
test('the owner manages, editors take part, viewers read; a stranger is not told the chat exists', async () => {
	const table = { owner: [200, 200, 200], editor: [200, 200, 403], listed: [200, 403, 403], stranger: [404, 404, 404], admin: [404, 404, 404] }
	for (const [who, expected] of Object.entries(table)) expect({ who, got: await statuses(person(who, who === 'admin' ? 'admin' : 'user'), privateChat) }).toEqual({ who, got: expected })
	expect(await statuses(null, privateChat)).toEqual([404, 403, 403])
	// Link access reads, and only that.
	expect(await statuses(stranger, linkChat)).toEqual([200, 403, 403])
	expect(await statuses(null, linkChat)).toEqual([200, 403, 403])
	// A banned owner does nothing.
	expect((await statuses(person('owner', 'user', true), linkChat)).slice(1)).toEqual([403, 403])
})

test('a group answer joins the round\'s speakers once, in the order answered; a branch has rounds of its own', async () => {
	await applyTurnTrigger(db, chatId, say('u1'), userId)
	const save = (id: string, lane: string) => saveAnswer(db, { id, chatId, parentId: 'u1', chatModelId: lane, parts: [{ type: 'text', text: id }], metadata: {} }, false, true)
	const speakers = async () => (await db.select().from(schema.message).where(eq(schema.message.id, 'u1')))[0]?.metadata?.speakers
	await save('b1', laneB)
	await save('a1', laneA)
	// A regenerate keeps the lane's place.
	await save('b2', laneB)
	expect(await speakers()).toEqual([laneB, laneA])
	// "Save and resend": the new branch has its own rounds; the earlier one keeps its order.
	expect((await branchMessage(db, chatId, 'u1', 'again', userId)).metadata).toBeNull()
	expect(await speakers()).toEqual([laneB, laneA])
})

test('a message names the tip it follows: after an older one it is refused, and another lane joining it is not', async () => {
	const after = (id: string, tip: string | null, lane = laneA): TurnRequest => ({ ...say(id, id, lane), after: tip } as TurnRequest)
	expect(await applyTurnTrigger(db, chatId, after('u1', null), userId)).toBe('u1')
	expect(await applyTurnTrigger(db, chatId, after('u2', 'u1'), userId)).toBe('u2')
	// Someone else wrote u2 meanwhile: a message written after u1 is refused, and nothing is saved.
	await expect(applyTurnTrigger(db, chatId, after('u3', 'u1'), userId)).rejects.toMatchObject({ status: 409 })
	expect(await ids()).toEqual(['u1', 'u2'])
	// The other lane's request for u2, written after u1 too, joins it.
	expect(await applyTurnTrigger(db, chatId, after('u2', 'u1', laneB), userId)).toBe('u2')
})
