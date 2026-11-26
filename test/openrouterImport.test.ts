import { beforeEach, expect, test } from 'bun:test'
import { asc, eq } from 'drizzle-orm'
import * as schema from '../server/db/schema'
import { openrouterToChatFile } from '../server/utils/chat/importers/openrouter'
import { importChat, readChatFile } from '../server/utils/chat/import'
import { chatFileSchema } from '../shared/utils/chatFile'
import { createTestDb, type TestDb } from './db'

// A Chatroom export in the shape of the samples (spike N): made by hand, not a copy of one.
const png = Buffer.from('tiny png').toString('base64')
const jpeg = Buffer.from('tiny jpeg').toString('base64')
const at = (minute: number) => `2026-11-25T10:${String(minute).padStart(2, '0')}:00.000Z`
const message = (id: string, type: 'user' | 'assistant', characterId: string, minute: number, items: string[], extra: Record<string, unknown> = {}) =>
	[id, { id, type, characterId, createdAt: at(minute), updatedAt: at(minute), context: 'main-chat', contentType: 'text', isEdited: false, isRetrying: false, isCollapsed: false, items: items.map((item, index) => ({ id: item, type: 'message', outputIndex: index, sequenceIndex: index })), ...extra }]
const item = (id: string, messageId: string, data: Record<string, unknown>) => [id, { id, messageId, data }]
const answered = (cost?: string) => ({ metadata: { variantSlug: 'deepseek/deepseek-v4.1-flash-1017', ...(cost && { cost, tokensCount: 994 }), routerMetadata: {}, plugins: [] } })

const chatroom = {
	version: 'orpg.3.0',
	title: 'Squares and shells',
	characters: {
		c1: { id: 'c1', model: 'deepseek/deepseek-v4.1-flash-1017', modelInfo: { name: 'DeepSeek: DeepSeek V4.1 Flash', short_name: 'DeepSeek V4.1 Flash' }, description: '', samplingParameters: {}, isDisabled: false, isRemoved: false, createdAt: at(0) },
		c2: { id: 'c2', model: 'moonshotai/kimi-k3.1-pro', modelInfo: { short_name: 'Kimi K3.1 Pro' }, description: '', samplingParameters: { top_p: 0.95 }, isDisabled: false, isRemoved: false, createdAt: at(5) },
	},
	messages: Object.fromEntries([
		message('u1', 'user', 'USER', 1, ['i-u1']),
		message('a1', 'assistant', 'c1', 2, ['rs1', 'm1', 'ws1', 'x1'], { parentMessageId: 'u1', ...answered('0') }),
		// A retry of a1: the newest shows.
		message('a1b', 'assistant', 'c1', 3, ['m1b'], { parentMessageId: 'u1', ...answered('0.0001') }),
		message('u2', 'user', 'USER', 6, ['i-u2'], { isEdited: true }),
		message('a2', 'assistant', 'c1', 7, ['rs2', 'sh1', 'rs3', 'm2'], { parentMessageId: 'u2', ...answered('0.0003237') }),
		// Stopped: no cost, a call still running, no text.
		message('a3', 'assistant', 'c2', 8, ['rs4', 'sh2'], { parentMessageId: 'u2', metadata: { variantSlug: 'moonshotai/kimi-k3.1-pro' } }),
	]),
	items: Object.fromEntries([
		item('i-u1', 'u1', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'What are these?' }, { type: 'input_image', image_url: `data:image/png;base64,${png}`, detail: 'auto' }, { type: 'input_image', image_url: `data:image/jpeg;base64,${jpeg}`, detail: 'auto' }] }),
		item('rs1', 'a1', { type: 'reasoning', status: 'completed', content: [{ type: 'reasoning_text', text: 'Two pictures.' }], summary: [] }),
		item('m1', 'a1', { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Both are squares.', annotations: [{ type: 'url_citation', url: 'https://example.com/a', title: 'A', start_index: 0, end_index: 4, content: 'quoted' }] }] }),
		item('ws1', 'a1', { type: 'openrouter:web_search', status: 'completed', action: { type: 'search', query: 'squares', sources: [{ type: 'url', url: 'https://example.com/a' }, { type: 'url', url: 'https://example.com/b' }] } }),
		item('x1', 'a1', { type: 'openrouter:image_generation', status: 'completed' }),
		item('m1b', 'a1b', { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Two squares.', annotations: [] }] }),
		item('i-u2', 'u2', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Now run ls.' }] }),
		item('rs2', 'a2', { type: 'reasoning', status: 'completed', content: [{ type: 'reasoning_text', text: 'Run it.' }], summary: [] }),
		item('sh1', 'a2', { type: 'openrouter:shell', status: 'completed', call_id: 'call_1', action: { commands: ['ls'] }, output: [{ stdout: 'a.txt\n', stderr: '', outcome: { type: 'exit', exit_code: 0 } }] }),
		item('rs3', 'a2', { type: 'reasoning', status: 'completed', summary: [], encrypted_content: 'opaque' }),
		item('m2', 'a2', { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'One file.', annotations: [] }] }),
		item('rs4', 'a3', { type: 'reasoning', status: 'completed', content: [{ type: 'reasoning_text', text: 'Let me look around.' }], summary: [] }),
		item('sh2', 'a3', { type: 'openrouter:shell', status: 'in_progress', call_id: 'call_2', action: { commands: ['find / -name x'] } }),
	]),
	artifacts: {},
	artifactFiles: {},
	artifactVersions: {},
	artifactFileContents: {},
}

test('a Chatroom export becomes a chat file: models as lanes, answers under their messages, parts and attachments', () => {
	const { file, notes } = openrouterToChatFile(chatroom)
	expect(() => chatFileSchema.parse(file)).not.toThrow()
	expect(file.chat.title).toBe('Squares and shells')
	expect(file.lanes.map(({ id, name, platform, modelId, params }) => ({ id, name, platform, modelId, params }))).toEqual([
		{ id: 'c1', name: 'DeepSeek V4.1 Flash', platform: 'openrouter', modelId: 'deepseek/deepseek-v4.1-flash-1017', params: {} },
		{ id: 'c2', name: 'Kimi K3.1 Pro', platform: 'openrouter', modelId: 'moonshotai/kimi-k3.1-pro', params: { topP: 0.95 } },
	])
	expect(file.messages.map(({ id, role, parentId, laneId }) => [id, role, parentId, laneId])).toEqual([
		['u1', 'user', null, null], ['a1', 'assistant', 'u1', 'c1'], ['a1b', 'assistant', 'u1', 'c1'],
		['u2', 'user', 'u1', null], ['a2', 'assistant', 'u2', 'c1'], ['a3', 'assistant', 'u2', 'c2'],
	])
	expect(file.tipId).toBe('u2')
	const parts = (id: string) => file.messages.find(entry => entry.id === id)!.parts

	// The images are attachments, named for the message's parts.
	const [first, second] = file.attachments
	expect(file.attachments.map(({ name, mediaType, data }) => [name, mediaType, data])).toEqual([['image-1.png', 'image/png', png], ['image-2.jpeg', 'image/jpeg', jpeg]])
	expect(parts('u1')).toEqual([{ type: 'text', text: 'What are these?' }, { type: 'file', mediaType: 'image/png', url: `/api/v1/files/${first!.id}`, filename: 'image-1.png' }, { type: 'file', mediaType: 'image/jpeg', url: `/api/v1/files/${second!.id}`, filename: 'image-2.jpeg' }])
	// Reasoning, text, then each source once, from the citation and the search.
	expect(parts('a1')).toEqual([{ type: 'reasoning', text: 'Two pictures.' }, { type: 'text', text: 'Both are squares.' }, { type: 'source-url', sourceId: 'https://example.com/a', url: 'https://example.com/a', title: 'A' }, { type: 'source-url', sourceId: 'https://example.com/b', url: 'https://example.com/b' }])
	// A shell call is a code block; encrypted reasoning is left out.
	expect(parts('a2')).toEqual([{ type: 'reasoning', text: 'Run it.' }, { type: 'text', text: '```shell\n$ ls\na.txt\n```' }, { type: 'text', text: 'One file.' }])
	expect(parts('a3')).toEqual([{ type: 'reasoning', text: 'Let me look around.' }, { type: 'text', text: '```shell\n$ find / -name x\n# stopped before it finished\n```' }])
	expect(file.messages.find(entry => entry.id === 'a2')!.metadata).toEqual({ platform: 'openrouter', model: 'deepseek/deepseek-v4.1-flash-1017', lane: { name: 'DeepSeek V4.1 Flash', color: null }, costUsd: 0.0003237, outputTokens: 994 })
	expect(file.messages.find(entry => entry.id === 'a3')!.metadata).toEqual({ platform: 'openrouter', model: 'moonshotai/kimi-k3.1-pro', lane: { name: 'Kimi K3.1 Pro', color: null } })
	expect(notes).toEqual(['an item of a kind not imported (openrouter:image_generation) was left out', 'reasoning that was sent encrypted was left out'])
})

let db: TestDb
let userId: string
beforeEach(async () => {
	db = await createTestDb()
	userId = (await db.insert(schema.user).values({ githubId: 1, username: 'u1' }).returning())[0]!.id
})

test('imported, it reads as the Chatroom showed it: the retry as the version shown, each model in its lane, the images attached', async () => {
	const { file } = readChatFile(JSON.stringify(chatroom))
	const stored: Record<string, string> = {}
	const { chatId, notes } = await importChat(db, {
		userId,
		file,
		folderId: null,
		offered: { platform: 'openrouter', models: { 'deepseek/deepseek-v4.1-flash-1017': true } },
		writeFile: async (path, bytes) => void (stored[path] = Buffer.from(bytes).toString()),
		removeFile: async () => {},
	})
	const lanes = await db.select().from(schema.chatModel).where(eq(schema.chatModel.chatId, chatId)).orderBy(asc(schema.chatModel.position))
	expect(lanes.map(lane => [lane.name, lane.modelId])).toEqual([['DeepSeek V4.1 Flash', 'deepseek/deepseek-v4.1-flash-1017'], ['Kimi K3.1 Pro', null]])
	expect(notes).toEqual(['moonshotai/kimi-k3.1-pro is not offered here: its lane uses the default model'])

	const rows = await db.select().from(schema.message).where(eq(schema.message.chatId, chatId)).orderBy(asc(schema.message.seq))
	const text = (row: typeof rows[number]) => row.parts.map(part => part.type === 'text' ? part.text : part.type === 'file' ? `[${part.filename}]` : '').join(' ').trim()
	const shown = rows.filter(row => row.active).map(row => `${row.role === 'user' ? 'You' : lanes.find(lane => lane.id === row.chatModelId)!.name}: ${text(row)}`)
	expect(shown).toEqual([
		'You: What are these? [image-1.png] [image-2.jpeg]',
		'DeepSeek V4.1 Flash: Two squares.',
		'You: Now run ls.',
		'DeepSeek V4.1 Flash: ```shell\n$ ls\na.txt\n``` One file.',
		'Kimi K3.1 Pro: ```shell\n$ find / -name x\n# stopped before it finished\n```',
	])
	// The first answer stays as the earlier version.
	expect(rows.filter(row => !row.active).map(text)).toEqual(['Both are squares.'])
	expect(Object.values(stored).toSorted()).toEqual(['tiny jpeg', 'tiny png'])
})
