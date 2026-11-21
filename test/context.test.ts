import { expect, test } from 'bun:test'
import type { UIMessage } from 'ai'
import { buildContext } from '../server/utils/chat/context'
import { DEFAULT_INSTRUCTIONS } from '../shared/utils/instructions'

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
