import { beforeEach, expect, test } from 'bun:test'
import { asc, eq } from 'drizzle-orm'
import type { UIMessage } from 'ai'
import * as schema from '../server/db/schema'
import { applyTurnTrigger, branchMessage, saveAnswer, type TurnRequest } from '../server/utils/chat/turns'
import { exportChat } from '../server/utils/chat/export'
import { importChat, readChatFile } from '../server/utils/chat/import'
import type { ChatFile } from '../shared/utils/chatFile'
import { createTestDb, type TestDb } from './db'

let db: TestDb
let userId: string
let otherId: string
let stored: Record<string, string>

beforeEach(async () => {
	db = await createTestDb()
	const [user, other] = await db.insert(schema.user).values([{ githubId: 1, username: 'u1', name: 'Captain' }, { githubId: 2, username: 'u2' }]).returning()
	userId = user!.id
	otherId = other!.id
	stored = {}
})

const say = (id: string, chatModelId: string, parts: UIMessage['parts'] = [{ type: 'text', text: id }]): TurnRequest => ({ trigger: 'submit-message', message: { id, role: 'user', parts: parts as never }, chatModelId })
const store = {
	writeFile: async (path: string, bytes: Uint8Array) => void (stored[path] = Buffer.from(bytes).toString()),
	removeFile: async (path: string) => void (stored = Object.fromEntries(Object.entries(stored).filter(([key]) => key !== path))),
}
const offered = { platform: 'deepseek' as const, models: { 'm-a': true as const } }

/** The export test's chat: two lanes (one with a Character), an image and a PDF, a regenerated answer, a branch, a vote. */
async function exportedChat() {
	const [character] = await db.insert(schema.character).values({ ownerId: userId, name: 'Keeper', instructions: 'You are {{char}}.' }).returning()
	const [chat] = await db.insert(schema.chat).values({ userId, title: 'Fruit' }).returning()
	const chatId = chat!.id
	const [laneA, laneB] = (await db.insert(schema.chatModel).values([
		{ chatId, position: 0, name: 'Alpha', modelId: 'm-a', platform: 'deepseek', characterId: character!.id, params: { temperature: 0.3 } },
		{ chatId, position: 1, modelId: 'm-b', platform: 'deepseek', params: { temperature: 0.7, reasoningLevel: 'high' } },
	]).returning()).map(lane => lane.id)
	const upload = async (name: string, mediaType: string) => (await db.insert(schema.file).values({ ownerId: userId, chatId, blobPath: `blob/${name}`, fileName: name, mediaType, size: 3 }).returning())[0]!.id
	const [image, pdf] = [await upload('fruit.png', 'image/png'), await upload('fruit.pdf', 'application/pdf')]
	await applyTurnTrigger(db, chatId, say('u1', laneA!, [{ type: 'file', mediaType: 'image/png', url: `/api/v1/files/${image}`, filename: 'fruit.png' }, { type: 'file', mediaType: 'application/pdf', url: `/api/v1/files/${pdf}`, filename: 'fruit.pdf' }, { type: 'text', text: 'Name the fruit.' }]), userId)
	const answer = (id: string, parentId: string, lane: string) => saveAnswer(db, { id, chatId, parentId, chatModelId: lane, parts: [{ type: 'reasoning', text: `${id} thinking`, providerMetadata: { deepseek: { signature: id } } }, { type: 'text', text: `${id} text` }], metadata: { platform: 'deepseek', model: 'm', costUsd: 0.01 } })
	await answer('a1', 'u1', laneA!)
	await answer('b1', 'u1', laneB!)
	await answer('a1v2', 'u1', laneA!)
	await applyTurnTrigger(db, chatId, say('u2', laneA!), userId)
	await answer('a2', 'u2', laneA!)
	const u2b = await branchMessage(db, chatId, 'u2', 'Another way', userId)
	await answer('a2b', u2b.id, laneA!)
	await db.insert(schema.vote).values({ chatId, messageId: 'a1v2', isUpvoted: true })
	return await exportChat(db, chatId, async path => new TextEncoder().encode(`bytes of ${path}`))
}

test('an import is a new chat with new ids throughout, the same tree, versions, tip, votes and attachments', async () => {
	const file = await exportedChat()
	const { chatId, notes } = await importChat(db, { userId: otherId, file, folderId: null, offered, ...store })
	const [chat] = await db.select().from(schema.chat).where(eq(schema.chat.id, chatId))
	const messages = await db.select().from(schema.message).where(eq(schema.message.chatId, chatId)).orderBy(asc(schema.message.seq))
	const byOld = Object.fromEntries(file.messages.map((message, index) => [message.id, messages[index]!]))

	expect(chat).toMatchObject({ userId: otherId, title: 'Fruit', leafId: byOld[file.tipId!]!.id })
	expect(messages).toHaveLength(file.messages.length)
	for (const original of file.messages) {
		const copy = byOld[original.id]!
		expect(copy.id).not.toBe(original.id)
		expect({ role: copy.role, active: copy.active, parent: copy.parentId, sender: copy.userId }).toEqual({ role: original.role, active: original.active, parent: original.parentId ? byOld[original.parentId]!.id : null, sender: original.role === 'user' ? otherId : null })
	}
	// Reasoning keeps its provider data, so the next turn sends what the original would.
	expect(byOld.a1v2!.parts[0]).toEqual({ type: 'reasoning', text: 'a1v2 thinking', providerMetadata: { deepseek: { signature: 'a1v2' } } })
	expect(byOld.a1v2!.metadata).toMatchObject({ costUsd: 0.01 })
	expect(await db.select({ messageId: schema.vote.messageId }).from(schema.vote).where(eq(schema.vote.chatId, chatId))).toEqual([{ messageId: byOld.a1v2!.id }])

	// The attachments are new files of the new chat, linked to the message that names them, their bytes stored anew.
	const files = await db.select().from(schema.file).where(eq(schema.file.chatId, chatId))
	expect(files.map(row => [row.fileName, row.messageId, stored[row.blobPath]])).toEqual([['fruit.png', byOld.u1!.id, 'bytes of blob/fruit.png'], ['fruit.pdf', byOld.u1!.id, 'bytes of blob/fruit.pdf']])
	expect(byOld.u1!.parts.slice(0, 2).map(part => (part as { url: string }).url)).toEqual(files.map(row => `/api/v1/files/${row.id}`))

	// Lane A's model is offered: kept, its Character as its own prompt. Lane B's is not: the default model, its name kept,
	// without the settings that belong to the model.
	const lanes = await db.select().from(schema.chatModel).where(eq(schema.chatModel.chatId, chatId)).orderBy(asc(schema.chatModel.position))
	expect(lanes.map(({ name, platform, modelId, systemPrompt, characterId, params }) => ({ name, platform, modelId, systemPrompt, characterId, params }))).toEqual([
		{ name: 'Alpha', platform: 'deepseek', modelId: 'm-a', systemPrompt: 'You are {{char}}.', characterId: null, params: { temperature: 0.3 } },
		{ name: 'm-b', platform: null, modelId: null, systemPrompt: null, characterId: null, params: { temperature: 0.7 } },
	])
	expect(notes).toEqual(['Keeper came as a prompt, not as a Character', 'm-b is not offered here: its lane uses the default model'])
	expect(byOld.a1!.chatModelId).toBe(lanes[0]!.id)
})

test('an attachment that fails the upload checks, or that the file left out, stays as a line naming it', async () => {
	const file = await exportedChat()
	file.attachments[0]!.mediaType = 'image/svg+xml'
	delete file.attachments[1]!.data
	const { chatId, notes } = await importChat(db, { userId: otherId, file, folderId: null, offered, ...store })
	const [first] = await db.select().from(schema.message).where(eq(schema.message.chatId, chatId)).orderBy(asc(schema.message.seq)).limit(1)
	expect(first!.parts).toEqual([{ type: 'text', text: '[Attachment not imported: fruit.png]' }, { type: 'text', text: '[Attachment not imported: fruit.pdf]' }, { type: 'text', text: 'Name the fruit.' }])
	expect(await db.select().from(schema.file).where(eq(schema.file.chatId, chatId))).toEqual([])
	expect(Object.keys(stored)).toEqual([])
	expect(notes).toContain('an attachment of a type not accepted (image/svg+xml) stays as its name')
	expect(notes).toContain('an attachment the file left out stays as its name')
})

test('a file over the limits, or one that does not hold together, is refused, and nothing is written', async () => {
	const file = await exportedChat()
	const chats = async () => (await db.select({ id: schema.chat.id }).from(schema.chat)).length
	const before = await chats()
	const attempt = (changed: ChatFile) => importChat(db, { userId: otherId, file: changed, folderId: null, offered, ...store })

	const tooLong = structuredClone(file)
	tooLong.messages[0]!.parts.push({ type: 'text', text: 'x'.repeat(100_001) })
	await expect(attempt(tooLong)).rejects.toMatchObject({ status: 400 })
	const forward = structuredClone(file)
	forward.messages[1]!.parentId = forward.messages.at(-1)!.id
	await expect(attempt(forward)).rejects.toMatchObject({ status: 400, message: expect.stringContaining('follows one that is not before it') })
	const strayLane = structuredClone(file)
	strayLane.messages[1]!.laneId = 'nowhere'
	await expect(attempt(strayLane)).rejects.toMatchObject({ status: 400 })
	expect(await chats()).toBe(before)
	// The stored files of a failed import are taken back.
	expect(Object.keys(stored)).toEqual([])

	const many = { ...file, messages: Array.from({ length: 5_001 }, (_, index) => ({ ...file.messages[0]!, id: `m${index}`, parentId: null })) }
	expect(() => readChatFile(JSON.stringify(many))).toThrow(expect.objectContaining({ status: 400 }))
})

test('a file that is not a chat file is refused', () => {
	expect(() => readChatFile('not json')).toThrow('This file is not JSON: import takes a chat file')
	expect(() => readChatFile('{"version":"orpg.3.0","messages":{}}')).toThrow('This is not a chat file')
	expect(() => readChatFile(JSON.stringify({ format: 'model-chat-studio.chat', version: 2 }))).toThrow(expect.objectContaining({ status: 400 }))
})
