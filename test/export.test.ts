import { beforeEach, expect, test } from 'bun:test'
import type { UIMessage } from 'ai'
import * as schema from '../server/db/schema'
import { applyTurnTrigger, branchMessage, saveAnswer, type TurnRequest } from '../server/utils/chat/turns'
import { chatMarkdown, exportChat } from '../server/utils/chat/export'
import { chatFileSchema } from '../shared/utils/chatFile'
import { createTestDb, type TestDb } from './db'

let db: TestDb
let userId: string

beforeEach(async () => {
	db = await createTestDb()
	const [user] = await db.insert(schema.user).values({ githubId: 1, username: 'u1', name: 'Captain' }).returning()
	userId = user!.id
})

async function makeChat(mode: 'separate' | 'group') {
	const [character] = await db.insert(schema.character).values({ ownerId: userId, name: 'Keeper', instructions: 'You are {{char}}.' }).returning()
	const [chat] = await db.insert(schema.chat).values({ userId, mode, title: 'Fruit' }).returning()
	const lanes = await db.insert(schema.chatModel).values([
		{ chatId: chat!.id, position: 0, name: 'Alpha', modelId: 'm-a', platform: 'deepseek', characterId: character!.id },
		{ chatId: chat!.id, position: 1, name: 'Beta', modelId: 'm-b', platform: 'deepseek', systemPrompt: 'Be brief.' },
	]).returning()
	return { chatId: chat!.id, laneA: lanes[0]!.id, laneB: lanes[1]!.id }
}

const say = (id: string, chatModelId: string, parts: UIMessage['parts'] = [{ type: 'text', text: id }]): TurnRequest => ({ trigger: 'submit-message', message: { id, role: 'user', parts: parts as never }, chatModelId })
const answer = (chatId: string, id: string, parentId: string, chatModelId: string, name: string, speaker = false) =>
	saveAnswer(db, { id, chatId, parentId, chatModelId, parts: [{ type: 'reasoning', text: `${id} thinking` }, { type: 'text', text: `${id} text` }], metadata: { platform: 'deepseek', model: 'm', lane: { name, color: null } } }, false, speaker)

test('a chat file holds every message of every branch and version, its lanes, votes and attachments, and passes its own schema', async () => {
	const { chatId, laneA, laneB } = await makeChat('separate')
	const upload = async (name: string, mediaType: string) => (await db.insert(schema.file).values({ ownerId: userId, chatId, blobPath: `blob/${name}`, fileName: name, mediaType, size: 3 }).returning())[0]!.id
	const [image, pdf] = [await upload('fruit.png', 'image/png'), await upload('fruit.pdf', 'application/pdf')]
	const files = [{ type: 'file', mediaType: 'image/png', url: `/api/v1/files/${image}`, filename: 'fruit.png' }, { type: 'file', mediaType: 'application/pdf', url: `/api/v1/files/${pdf}`, filename: 'fruit.pdf' }, { type: 'text', text: 'Name the fruit.' }]
	await applyTurnTrigger(db, chatId, say('u1', laneA, files as UIMessage['parts']), userId)
	await answer(chatId, 'a1', 'u1', laneA, 'Alpha')
	await answer(chatId, 'b1', 'u1', laneB, 'Beta')
	// Alpha's answer again: a1 becomes its earlier version.
	await answer(chatId, 'a1v2', 'u1', laneA, 'Alpha')
	await applyTurnTrigger(db, chatId, say('u2', laneA), userId)
	await answer(chatId, 'a2', 'u2', laneA, 'Alpha')
	// "Save and resend" on u2: a branch, which becomes the tip.
	const u2b = await branchMessage(db, chatId, 'u2', 'Another way', userId)
	await answer(chatId, 'a2b', u2b.id, laneA, 'Alpha')
	await db.insert(schema.vote).values({ chatId, messageId: 'a1v2', isUpvoted: true })

	const file = await exportChat(db, chatId, async path => new TextEncoder().encode(path))
	expect(() => chatFileSchema.parse(file)).not.toThrow()
	expect(file.messages.map(message => message.id)).toEqual(['u1', 'a1', 'b1', 'a1v2', 'u2', 'a2', u2b.id, 'a2b'])
	expect(file.messages.find(message => message.id === 'a1')?.active).toBe(false)
	expect(file.messages.find(message => message.id === 'u1')?.author).toBe('Captain')
	expect(file.tipId).toBe(u2b.id)
	expect(file.votes).toEqual([{ messageId: 'a1v2', isUpvoted: true }])
	expect(file.lanes.map(lane => [lane.name, lane.character?.name ?? null, lane.systemPrompt])).toEqual([['Alpha', 'Keeper', null], ['Beta', null, 'Be brief.']])
	expect(file.attachments.map(attachment => [attachment.name, Buffer.from(attachment.data!, 'base64').toString()])).toEqual([['fruit.png', 'blob/fruit.png'], ['fruit.pdf', 'blob/fruit.pdf']])
	// Without the bytes, the names only.
	expect((await exportChat(db, chatId)).attachments.every(attachment => attachment.data === undefined && attachment.name)).toBe(true)

	// The Markdown is the branch that shows, top to bottom as the page reads: no earlier version, no other branch.
	const markdown = chatMarkdown(file)
	const at = (text: string) => markdown.indexOf(text)
	expect(markdown.startsWith('# Fruit\n')).toBe(true)
	expect([at('## Captain'), at('*Attachment: fruit.png*'), at('a1v2 text'), at('b1 text'), at('Another way'), at('a2b text')].every((index, i, all) => index > (all[i - 1] ?? -1))).toBe(true)
	expect(markdown).toContain('<details>\n<summary>Reasoning</summary>\n\na1v2 thinking')
	for (const hidden of ['a1 text', 'u2\n', 'a2 text']) expect(markdown).not.toContain(hidden)
})

test('the Markdown of a group round follows the speaking order, not the order the answers were saved in', async () => {
	const { chatId, laneA, laneB } = await makeChat('group')
	await applyTurnTrigger(db, chatId, say('u1', laneB), userId)
	// Beta spoke first, then Alpha; Alpha's answer was saved first.
	await db.update(schema.message).set({ metadata: { speakers: [laneB, laneA] } })
	await answer(chatId, 'a1', 'u1', laneA, 'Alpha')
	await answer(chatId, 'b1', 'u1', laneB, 'Beta')
	const markdown = chatMarkdown(await exportChat(db, chatId))
	expect(markdown.indexOf('b1 text')).toBeLessThan(markdown.indexOf('a1 text'))
	expect(markdown).toContain('## Beta · m')
})
