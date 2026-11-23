import { beforeEach, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import type { UIMessage } from 'ai'
import * as schema from '../server/db/schema'
import { chatAbilities, type ChatAccess } from '../shared/abilities/chatAbilities'
import { authorize } from '../server/utils/core/authorize'
import { setSetting } from '../server/utils/core/settings'
import { answerAttempt, applyTurnTrigger, deleteMessage, editMessage, listAnswerVersions, listChatMessages, monthlyBudgetStatus, saveAnswer, showVersion, type TurnRequest } from '../server/utils/chat/turns'
import { assertLaneLimit, countEnabledLanes } from '../server/utils/chat/lanes'
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

test('a new message is saved and answered; it follows the previous message', async () => {
	expect(await applyTurnTrigger(db, chatId, say('u1'))).toBe('u1')
	await answer('a1', 'u1')
	expect(await applyTurnTrigger(db, chatId, say('u2'))).toBe('u2')
	const [saved] = await db.select().from(schema.message).where(eq(schema.message.id, 'u2'))
	expect(saved?.parentId).toBe('a1')
	expect(await ids()).toEqual(['u1', 'a1', 'u2'])
})

test('another lane sending the same message joins it: nothing is saved twice or dropped', async () => {
	await applyTurnTrigger(db, chatId, say('u1'))
	await answer('a1', 'u1', laneA)

	expect(await applyTurnTrigger(db, chatId, say('u1', 'u1', laneB))).toBe('u1')
	// Again from lane B, before it has answered (a retry after a failed answer): still a join.
	expect(await applyTurnTrigger(db, chatId, say('u1', 'u1', laneB))).toBe('u1')
	expect(await ids()).toEqual(['u1', 'a1'])
})

test('resending a message that is not a join is refused: it changed, the lane answered it, or a newer message exists', async () => {
	await applyTurnTrigger(db, chatId, say('u1'))
	await answer('a1', 'u1', laneA)
	await expect(applyTurnTrigger(db, chatId, say('u1', 'u1', laneA))).rejects.toMatchObject({ status: 409 })
	await expect(applyTurnTrigger(db, chatId, say('u1', 'changed', laneB))).rejects.toMatchObject({ status: 409 })
	await applyTurnTrigger(db, chatId, say('u2'))
	await expect(applyTurnTrigger(db, chatId, say('u1', 'u1', laneB))).rejects.toMatchObject({ status: 409 })
	// A message id from someone else's chat is not taken over.
	const [other] = await db.insert(schema.chat).values({ userId }).returning()
	await expect(applyTurnTrigger(db, other!.id, say('u1'))).rejects.toMatchObject({ status: 409 })
	expect(await ids()).toEqual(['u1', 'a1', 'u2'])
	expect(await listChatMessages(db, other!.id)).toEqual([])
})

test('regenerating answers the question again; the new answer is shown in place of only that lane\'s answer, under its question', async () => {
	await applyTurnTrigger(db, chatId, say('u1'))
	await answer('a1', 'u1', laneA)
	await answer('b1', 'u1', laneB)
	await applyTurnTrigger(db, chatId, say('u2'))
	await answer('a2', 'u2', laneA)

	expect(await applyTurnTrigger(db, chatId, regenerate('a1'))).toBe('u1')
	// Nothing is deleted until the new answer is saved, so a failed turn keeps the old one.
	expect(await ids()).toEqual(['u1', 'a1', 'b1', 'u2', 'a2'])
	await answer('a1x', 'u1', laneA)
	expect(await ids()).toEqual(['u1', 'b1', 'a1x', 'u2', 'a2'])
	expect(await ids(laneA)).toEqual(['u1', 'a1x', 'u2', 'a2'])

	expect(await applyTurnTrigger(db, chatId, regenerate('u1', laneB))).toBe('u1')
	expect(await applyTurnTrigger(db, chatId, regenerate())).toBe('u2')
})

test('a regenerated answer keeps its earlier versions; any of them can be shown, and the threads follow', async () => {
	await applyTurnTrigger(db, chatId, say('u1'))
	await answer('a1', 'u1', laneA)
	await answer('b1', 'u1', laneB)
	await applyTurnTrigger(db, chatId, say('u2'))
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
	await applyTurnTrigger(db, chatId, say('u1'))
	for (const [id, attempt] of [['a1', 1], ['a1x', 2], ['a1y', 3]] as const) {
		await saveAnswer(db, { id, chatId, parentId: 'u1', chatModelId: laneA, parts: [], metadata: { platform: 'deepseek', model: 'm', attempt } })
	}
	await showVersion(db, chatId, 'a1')
	expect(await answerAttempt(db, laneA, 'u1')).toBe(3)
})

test('a stopped answer can leave the earlier answer in place; a first answer is saved either way', async () => {
	const save = (id: string, parentId: string) => saveAnswer(db, { id, chatId, parentId, chatModelId: laneA, parts: [{ type: 'text', text: id }], metadata: { platform: 'deepseek', model: 'm' } }, true)
	await applyTurnTrigger(db, chatId, say('u1'))
	await answer('a1', 'u1')
	expect(await save('a1x', 'u1')).toBe(false)
	expect(await ids()).toEqual(['u1', 'a1'])

	await applyTurnTrigger(db, chatId, say('u2'))
	expect(await save('a2', 'u2')).toBe(true)
	expect(await ids()).toEqual(['u1', 'a1', 'u2', 'a2'])
})

test('an answer counts its attempts per lane; the lane limit follows the admin setting', async () => {
	await applyTurnTrigger(db, chatId, say('u1'))
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
	await expect(applyTurnTrigger(db, chatId, regenerate())).rejects.toMatchObject({ status: 400 })
	await applyTurnTrigger(db, chatId, say('u1'))
	await answer('b1', 'u1', laneB)
	await expect(applyTurnTrigger(db, chatId, regenerate('b1', laneA))).rejects.toMatchObject({ status: 400 })
	await expect(applyTurnTrigger(db, chatId, regenerate('missing'))).rejects.toMatchObject({ status: 404 })
})

test('a lane sees every user message and only its own answers; a lane added late sees questions without answers', async () => {
	await applyTurnTrigger(db, chatId, say('u1'))
	await applyTurnTrigger(db, chatId, say('u1', 'u1', laneB))
	await answer('a1', 'u1', laneA)
	await answer('b1', 'u1', laneB)
	await applyTurnTrigger(db, chatId, say('u2'))
	await answer('a2', 'u2', laneA)

	expect(await ids()).toEqual(['u1', 'a1', 'b1', 'u2', 'a2'])
	expect(await ids(laneA)).toEqual(['u1', 'a1', 'u2', 'a2'])
	expect(await ids(laneB)).toEqual(['u1', 'b1', 'u2'])
	const [late] = await db.insert(schema.chatModel).values({ chatId, position: 2 }).returning()
	expect(await ids(late!.id)).toEqual(['u1', 'u2'])
})

test('a lane\'s thread holds its own summaries only, where they were made', async () => {
	await applyTurnTrigger(db, chatId, say('u1'))
	await answer('a1', 'u1', laneA)
	await answer('b1', 'u1', laneB)
	await db.insert(schema.message).values([
		{ id: 'sA', chatId, role: 'system', parts: [{ type: 'text', text: 'A so far' }], chatModelId: laneA },
		{ id: 'sB', chatId, role: 'system', parts: [{ type: 'text', text: 'B so far' }], chatModelId: laneB },
	])
	await applyTurnTrigger(db, chatId, say('u2'))

	expect(await ids()).toEqual(['u1', 'a1', 'b1', 'sA', 'sB', 'u2'])
	expect(await ids(laneA)).toEqual(['u1', 'a1', 'sA', 'u2'])
	expect(await ids(laneB)).toEqual(['u1', 'b1', 'sB', 'u2'])
})

test('editing a message changes only its text; with dropAfter its answers and the later turns go', async () => {
	await applyTurnTrigger(db, chatId, say('u1'))
	await answer('a1', 'u1')
	await applyTurnTrigger(db, chatId, say('u2'))
	await answer('a2', 'u2')
	await applyTurnTrigger(db, chatId, say('u3'))
	await answer('a3', 'u3')
	// Regenerated last, so saved after everything else, but it answers u1.
	await answer('a1x', 'u1')

	const { message } = await editMessage(db, chatId, 'u2', { text: 'new' })
	expect(message.parts).toEqual([{ type: 'text', text: 'new' }])
	expect(await ids()).toEqual(['u1', 'a1x', 'u2', 'a2', 'u3', 'a3'])

	await editMessage(db, chatId, 'u2', { text: 'again', dropAfter: true })
	expect(await ids()).toEqual(['u1', 'a1x', 'u2'])
})

test('editing an answer replaces its text, keeps its other parts and marks it edited', async () => {
	await applyTurnTrigger(db, chatId, say('u1'))
	await answer('a1', 'u1', laneA, [
		{ type: 'reasoning', text: 'thinking' },
		{ type: 'text', text: 'old' },
		{ type: 'source-url', sourceId: 's', url: 'https://example.com' },
		{ type: 'text', text: 'more' },
	])
	const { message } = await editMessage(db, chatId, 'a1', { text: 'new' })
	expect(message.parts).toEqual([
		{ type: 'reasoning', text: 'thinking' },
		{ type: 'text', text: 'new' },
		{ type: 'source-url', sourceId: 's', url: 'https://example.com' },
	])
	expect(message.metadata).toMatchObject({ model: 'm', edited: true })
	await expect(editMessage(db, chatId, 'a1', { text: 'x', dropAfter: true })).rejects.toMatchObject({ status: 400 })
	await expect(editMessage(db, chatId, 'missing', { text: 'x' })).rejects.toMatchObject({ status: 404 })
})

test('deleting removes an answer alone, or a user message with its answers', async () => {
	await applyTurnTrigger(db, chatId, say('u1'))
	await answer('a1', 'u1', laneA)
	await answer('b1', 'u1', laneB)
	await applyTurnTrigger(db, chatId, say('u2'))
	await answer('a2', 'u2', laneA)

	expect((await deleteMessage(db, chatId, 'b1')).ids).toEqual(['b1'])
	expect(await ids()).toEqual(['u1', 'a1', 'u2', 'a2'])
	expect((await deleteMessage(db, chatId, 'u1')).ids).toEqual(['u1', 'a1'])
	expect(await ids()).toEqual(['u2', 'a2'])
	const [other] = await db.insert(schema.chat).values({ userId }).returning()
	await expect(deleteMessage(db, other!.id, 'u2')).rejects.toMatchObject({ status: 404 })
})

test('attachments link to their message once, only from the chat owner, and are reported when their message is deleted', async () => {
	const [stranger] = await db.insert(schema.user).values({ githubId: 2, username: 'u2' }).returning()
	const upload = async (ownerId: string) => (await db.insert(schema.file).values({ ownerId, chatId, blobPath: 'x', mediaType: 'image/png', size: 1 }).returning())[0]!.id
	const withFile = (id: string, fileId: string): TurnRequest => ({
		trigger: 'submit-message',
		message: { id, role: 'user', parts: [{ type: 'text', text: 'see' }, { type: 'file', mediaType: 'image/png', url: `/api/v1/files/${fileId}` }] },
		chatModelId: laneA,
	})
	const mine = await upload(userId)
	const theirs = await upload(stranger!.id)
	await applyTurnTrigger(db, chatId, say('u0'))
	await answer('a0', 'u0')

	await expect(applyTurnTrigger(db, chatId, withFile('u1', theirs))).rejects.toMatchObject({ status: 400 })
	expect(await ids()).toEqual(['u0', 'a0'])

	await applyTurnTrigger(db, chatId, withFile('u1', mine))
	const [linked] = await db.select().from(schema.file).where(eq(schema.file.id, mine))
	expect(linked?.messageId).toBe('u1')
	await answer('a1', 'u1')
	// Already part of u1, so another message cannot take it.
	await expect(applyTurnTrigger(db, chatId, withFile('u2', mine))).rejects.toMatchObject({ status: 400 })
	// The editor cannot show attachments.
	await expect(editMessage(db, chatId, 'u1', { text: 'x' })).rejects.toMatchObject({ status: 400 })

	// Resending u0 drops u1, and with it u1's attachment.
	expect((await editMessage(db, chatId, 'u0', { text: 'edited', dropAfter: true })).removedFileIds).toEqual([mine])
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
const privateChat: ChatAccess = { userId: 'owner', visibility: 'private', sharedWith: ['listed'] }
const linkChat: ChatAccess = { ...privateChat, visibility: 'public' }

const read = (user: TestUser | null, chat?: ChatAccess) => authorize(eventFor(user), chatAbilities().readChat as never, chat as never)
const manage = (user: TestUser | null, chat?: ChatAccess) => authorize(eventFor(user), chatAbilities().manageChat as never, chat as never)

test('a private chat is readable by its owner and the people it is shared with; everyone else gets 404', async () => {
	await read(owner, privateChat)
	await read(listed, privateChat)
	for (const user of [stranger, admin, null]) await expect(read(user, privateChat)).rejects.toMatchObject({ status: 404 })
	await expect(read(owner, undefined)).rejects.toMatchObject({ status: 404 })
})

test('link access lets anyone read, guests included', async () => {
	for (const user of [stranger, admin, null]) await read(user, linkChat)
})

test('only the owner may change a chat; shared and link access are read-only', async () => {
	await manage(owner, linkChat)
	for (const user of [listed, stranger, admin]) await expect(manage(user, linkChat)).rejects.toMatchObject({ status: 404 })
	await expect(manage(null, linkChat)).rejects.toMatchObject({ status: 403 })
	await expect(manage(person('owner', 'user', true), linkChat)).rejects.toMatchObject({ status: 403 })
})

test('a group answer joins the round\'s speakers once, in the order answered; "Save and resend" clears them', async () => {
	await applyTurnTrigger(db, chatId, say('u1'))
	const save = (id: string, lane: string) => saveAnswer(db, { id, chatId, parentId: 'u1', chatModelId: lane, parts: [{ type: 'text', text: id }], metadata: {} }, false, true)
	const speakers = async () => (await db.select().from(schema.message).where(eq(schema.message.id, 'u1')))[0]?.metadata?.speakers
	await save('b1', laneB)
	await save('a1', laneA)
	// A regenerate keeps the lane's place.
	await save('b2', laneB)
	expect(await speakers()).toEqual([laneB, laneA])
	await editMessage(db, chatId, 'u1', { text: 'again', dropAfter: true })
	expect(await speakers()).toBeUndefined()
})
