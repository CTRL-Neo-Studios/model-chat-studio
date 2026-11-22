import { expect, test } from 'bun:test'
import type { UIMessage } from 'ai'
import { buildContext } from '../server/utils/chat/context'
import { DEFAULT_INSTRUCTIONS } from '../shared/utils/instructions'
import type { ProfileBlock } from '../shared/utils/structureProfile'

const text = (id: string, role: UIMessage['role'], value: string): UIMessage => ({ id, role, parts: [{ type: 'text', text: value }] })
// u1 a1 u2 a2(reasoning only) u3 a3 u4: the lane's thread up to the message being answered, u4.
const thread: UIMessage[] = [
	text('u1', 'user', 'one'),
	text('a1', 'assistant', 'first answer'),
	text('u2', 'user', 'two'),
	{ id: 'a2', role: 'assistant', parts: [{ type: 'reasoning', text: 'thinking only' }] },
	text('u3', 'user', 'three'),
	text('a3', 'assistant', 'third answer'),
	text('u4', 'user', 'four'),
]
const sent = (memoryLength: number | null, from = thread) =>
	buildContext({ thread: from, systemPrompt: null, webSearch: false, memoryLength }).messages.map(message => message.id)

test('the memory length sends the last N messages, never starting on an answer', () => {
	expect(sent(null)).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3', 'u4'])
	expect(sent(1)).toEqual(['u4'])
	// a3 u4 would start on an answer: its question is gone, so it goes too.
	expect(sent(2)).toEqual(['u4'])
	expect(sent(3)).toEqual(['u3', 'a3', 'u4'])
	// A reasoning-only answer does not count: four counted messages reach back to u2.
	expect(sent(4)).toEqual(['u2', 'a2', 'u3', 'a3', 'u4'])
	expect(sent(100)).toEqual(sent(null))
})

test('a summary replaces what came before it, is sent as a user message, and memory counts after it', () => {
	const withSummary = [...thread.slice(0, 3), text('s1', 'system', 'They counted to two.'), ...thread.slice(3)]
	const context = buildContext({ thread: withSummary, systemPrompt: 'Be brief.', webSearch: true, memoryLength: 3 })
	expect(context.messages.map(message => [message.id, message.role])).toEqual([['s1', 'user'], ['u3', 'user'], ['a3', 'assistant'], ['u4', 'user']])
	expect(context.instructions).toStartWith('Be brief.\n\nWeb search is on')
	expect(context.blocks.map(block => block.kind)).toEqual(['instructions', 'omitted', 'summary', 'message', 'message', 'message'])
	expect(context.blocks[1]).toMatchObject({ count: 1 })
})

test('without a system prompt the default instructions apply, and nothing is left out', () => {
	const context = buildContext({ thread, systemPrompt: null, webSearch: false, memoryLength: null })
	expect(context.instructions).toBe(DEFAULT_INSTRUCTIONS)
	expect(context.blocks.filter(block => block.kind === 'omitted')).toEqual([])
	expect(context.blocks.at(-1)).toMatchObject({ kind: 'message', role: 'user', messageId: 'u4', size: 4 })
})

// The two example profiles of the brief (milestones 2–4 plan, 4.5).
const roleplay: ProfileBlock[] = [
	{ id: 'r1', kind: 'message', role: 'system', text: 'You are Captain Sage, a pirate.' },
	{ id: 'r2', kind: 'history' },
	{ id: 'r3', kind: 'message', role: 'user', text: 'Stay in character and answer in two sentences.' },
	{ id: 'r4', kind: 'autoFetch' },
]
const programming: ProfileBlock[] = [
	{ id: 'p1', kind: 'history' },
	{ id: 'p2', kind: 'message', role: 'system', text: 'Write TypeScript with tabs.' },
	{ id: 'p3', kind: 'message', role: 'user', text: 'Prefer small pure functions.' },
	{ id: 'p4', kind: 'message', role: 'system', text: 'Name things in plain English.' },
	{ id: 'p5', kind: 'files', paths: ['docs/conventions.md', 'src', 'missing.md'] },
]
const resolvePath = (path: string) => ({ 'docs/conventions.md': { entryId: 'e1', kind: 'note' as const }, 'src': { entryId: 'e2', kind: 'folder' as const } })[path]
const shape = (context: ReturnType<typeof buildContext>) => context.messages.map(message => `${message.role}:${message.id}`)

test('a roleplaying profile: its system block joins the instructions, then the thread, its message, and where auto-fetch goes', () => {
	const context = buildContext({ thread: thread.slice(-3), systemPrompt: null, webSearch: false, memoryLength: null, profile: roleplay, resolvePath })
	// It replaces the default instructions when the lane has no prompt of its own.
	expect(context.instructions).toBe('You are Captain Sage, a pirate.')
	expect(shape(context)).toEqual(['user:u3', 'assistant:a3', 'user:u4', 'user:profile-r3'])
	expect(context.autoFetchAt).toBe(4)
	expect(context.blocks.map(block => `${block.kind}:${block.label}`)).toEqual([
		'instructions:Structure profile', 'message:Message', 'message:Answer', 'message:Message', 'profile:Profile: user message', 'autoFetch:Auto-fetch: nothing matched',
	])
	// With a lane prompt, the lane's comes first.
	expect(buildContext({ thread, systemPrompt: 'Be brief.', webSearch: false, memoryLength: null, profile: roleplay }).instructions).toBe('Be brief.\n\nYou are Captain Sage, a pirate.')
})

test('a programming profile: the thread first, then its messages (later system ones as user messages) and its files', () => {
	const context = buildContext({ thread: thread.slice(-1), systemPrompt: null, webSearch: false, memoryLength: null, profile: programming, resolvePath })
	expect(context.instructions).toBe(DEFAULT_INSTRUCTIONS)
	expect(shape(context)).toEqual(['user:u4', 'user:profile-p2', 'user:profile-p3', 'user:profile-p4', 'user:profile-p5'])
	expect(context.messages[1]!.parts).toEqual([{ type: 'text', text: 'Write TypeScript with tabs.' }])
	expect(context.messages[4]!.parts.slice(1)).toEqual([
		{ type: 'data-reference', data: { entryId: 'e1', name: 'docs/conventions.md', kind: 'note' } },
		{ type: 'data-reference', data: { entryId: 'e2', name: 'src', kind: 'folder' } },
	])
	expect(context.autoFetchAt).toBeNull()
	expect(context.blocks.at(-1)!.label).toBe('Profile: files (not in the library: missing.md)')
})
