import { beforeEach, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import * as schema from '../server/db/schema'
import { chatAbilities, type ChatAccess } from '../shared/abilities/chatAbilities'
import { authorize } from '../server/utils/core/authorize'
import { setSetting } from '../server/utils/core/settings'
import { applyTurnTrigger, listChatMessages, monthlyBudgetStatus, type TurnRequest } from '../server/utils/chat/turns'
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

async function answer(id: string, parentId?: string, chatModelId = laneA) {
	await db.insert(schema.message).values({ id, chatId, parentId, chatModelId, role: 'assistant', parts: [{ type: 'text', text: id }] })
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

test('a new message is saved and answered; it replies to the previous message', async () => {
	expect(await applyTurnTrigger(db, chatId, say('u1'))).toMatchObject({ parentId: 'u1' })
	await answer('a1')
	expect(await applyTurnTrigger(db, chatId, say('u2'))).toMatchObject({ parentId: 'u2' })
	const [saved] = await db.select().from(schema.message).where(eq(schema.message.id, 'u2'))
	expect(saved?.parentId).toBe('a1')
	expect(await ids()).toEqual(['u1', 'a1', 'u2'])
})

test('editing a message replaces its text and drops everything after it', async () => {
	await applyTurnTrigger(db, chatId, say('u1'))
	await answer('a1')
	await applyTurnTrigger(db, chatId, say('u2'))
	await answer('a2')

	expect(await applyTurnTrigger(db, chatId, say('u1', 'edited'))).toMatchObject({ parentId: 'u1' })
	const messages = await listChatMessages(db, chatId)
	expect(messages.map(message => message.id)).toEqual(['u1'])
	expect(messages[0]!.parts).toEqual([{ type: 'text', text: 'edited' }])
})

test('regenerating replaces the target answer and everything after it', async () => {
	await applyTurnTrigger(db, chatId, say('u1'))
	await answer('a1')
	await applyTurnTrigger(db, chatId, say('u2'))
	await answer('a2')

	expect(await applyTurnTrigger(db, chatId, regenerate('a1'))).toMatchObject({ parentId: 'u1' })
	expect(await ids()).toEqual(['u1'])
})

test('regenerating from a user message keeps it; without a target, the last answer is replaced', async () => {
	await applyTurnTrigger(db, chatId, say('u1'))
	await answer('a1')
	expect(await applyTurnTrigger(db, chatId, regenerate('u1'))).toMatchObject({ parentId: 'u1' })
	expect(await ids()).toEqual(['u1'])

	await answer('a1b')
	expect(await applyTurnTrigger(db, chatId, regenerate())).toMatchObject({ parentId: 'u1' })
	expect(await ids()).toEqual(['u1'])
	// The first answer of a new chat: the last message is the user's, nothing is dropped.
	expect(await applyTurnTrigger(db, chatId, regenerate())).toMatchObject({ parentId: 'u1' })
	expect(await ids()).toEqual(['u1'])
})

test('a trigger that does not fit changes nothing', async () => {
	await expect(applyTurnTrigger(db, chatId, regenerate())).rejects.toMatchObject({ status: 400 })
	await applyTurnTrigger(db, chatId, say('u1'))
	await answer('a1')

	await expect(applyTurnTrigger(db, chatId, say('a1'))).rejects.toMatchObject({ status: 400 })
	await expect(applyTurnTrigger(db, chatId, regenerate('missing'))).rejects.toMatchObject({ status: 404 })
	// A message id from someone else's chat is not taken over.
	const [other] = await db.insert(schema.chat).values({ userId }).returning()
	await expect(applyTurnTrigger(db, other!.id, say('u1'))).rejects.toMatchObject({ status: 409 })
	expect(await ids()).toEqual(['u1', 'a1'])
	expect(await listChatMessages(db, other!.id)).toEqual([])
})

test('another lane sending the same message joins it: nothing is saved twice or dropped', async () => {
	await applyTurnTrigger(db, chatId, say('u1'))
	await answer('a1', 'u1', laneA)

	expect(await applyTurnTrigger(db, chatId, say('u1', 'u1', laneB))).toEqual({ parentId: 'u1', removedFileIds: [] })
	expect(await ids()).toEqual(['u1', 'a1'])
	// Again from lane B, before it has answered (a retry after a failed answer): still a join.
	expect(await applyTurnTrigger(db, chatId, say('u1', 'u1', laneB))).toEqual({ parentId: 'u1', removedFileIds: [] })
	expect(await ids()).toEqual(['u1', 'a1'])
})

test('resending a message is an edit when its text changed, the lane already answered it, or a newer message exists', async () => {
	await applyTurnTrigger(db, chatId, say('u1'))
	await answer('a1', 'u1', laneA)
	await applyTurnTrigger(db, chatId, say('u1', 'u1', laneA))
	expect(await ids()).toEqual(['u1'])

	await answer('a1', 'u1', laneA)
	await applyTurnTrigger(db, chatId, say('u1', 'changed', laneB))
	expect(await ids()).toEqual(['u1'])

	await answer('a1', 'u1', laneA)
	await applyTurnTrigger(db, chatId, say('u2'))
	await applyTurnTrigger(db, chatId, say('u1', 'changed', laneB))
	expect(await ids()).toEqual(['u1'])
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

test('attachments link to their message once, only from the chat owner, and are reported when their message is dropped', async () => {
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
	await answer('a0')

	await expect(applyTurnTrigger(db, chatId, withFile('u1', theirs))).rejects.toMatchObject({ status: 400 })
	expect(await ids()).toEqual(['u0', 'a0'])

	await applyTurnTrigger(db, chatId, withFile('u1', mine))
	const [linked] = await db.select().from(schema.file).where(eq(schema.file.id, mine))
	expect(linked?.messageId).toBe('u1')
	await answer('a1')
	// Already part of u1, so another message cannot take it.
	await expect(applyTurnTrigger(db, chatId, withFile('u2', mine))).rejects.toMatchObject({ status: 400 })

	expect(await applyTurnTrigger(db, chatId, regenerate('a1'))).toEqual({ parentId: 'u1', removedFileIds: [] })
	// Editing u0 drops a0 and u1, and with it u1's attachment.
	expect(await applyTurnTrigger(db, chatId, say('u0', 'edited'))).toEqual({ parentId: 'u0', removedFileIds: [mine] })
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
