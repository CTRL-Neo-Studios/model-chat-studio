import { expect, test } from 'bun:test'
import type { UIMessage } from 'ai'
import type { MessageMetadata } from '../shared/utils/chat'
import { groupThread } from '../server/utils/chat/group'

type Stored = UIMessage<MessageMetadata> & { chatModelId?: string | null, parentId?: string | null }

const user = (id: string, text: string, speakers?: string[]): Stored => ({ id, role: 'user', parts: [{ type: 'text', text }], metadata: speakers && { speakers } })
const answer = (id: string, parentId: string, lane: string, text: string): Stored => ({
	id, role: 'assistant', parentId, chatModelId: lane, metadata: { lane: { name: lane, color: null } },
	parts: [{ type: 'reasoning', text: `${lane} thinking` }, { type: 'text', text }],
})
// Two rounds; round 1 answered Engineer then Designer, round 2 Designer then Engineer. Stored order is not
// speaking order: a regenerated answer is saved last.
const chat: Stored[] = [
	user('u1', 'Plan the app', ['Engineer', 'Designer']),
	answer('d1', 'u1', 'Designer', 'Make it blue'),
	answer('e1', 'u1', 'Engineer', 'Use Vue'),
	user('u2', 'Next step', ['Designer', 'Engineer']),
	answer('d2', 'u2', 'Designer', 'Draw the screens'),
	answer('e2', 'u2', 'Engineer', 'Build the screens'),
]
const read = (thread: UIMessage[]) => thread.map(message => `${message.role} ${message.parts.map(part => part.type === 'text' ? part.text : `[${part.type}]`).join(' ')}`)

test('a speaker sees the user and the others by name, its own answers as its own, in speaking order', () => {
	expect(read(groupThread(chat, { laneId: 'Designer', questionId: 'u2', userName: 'Captain' }))).toEqual([
		'user Captain: Plan the app',
		'user Engineer: Use Vue',
		// Its own answer whole, reasoning included; the others' as text only.
		'assistant [reasoning] Make it blue',
		'user Captain: Next step',
	])
})

test('regenerating sees only the speakers before it in that round', () => {
	// The Engineer spoke second in round 2: it sees the Designer's answer, not its own earlier one.
	expect(read(groupThread(chat, { laneId: 'Engineer', questionId: 'u2', userName: 'Captain' })).slice(-2)).toEqual([
		'user Captain: Next step',
		'user Designer: Draw the screens',
	])
	// The Designer spoke first in round 2: nobody before it, and the Engineer's later answer is left out.
	expect(read(groupThread(chat, { laneId: 'Designer', questionId: 'u2', userName: 'Captain' })).at(-1)).toBe('user Captain: Next step')
	// The thread ends at the round being answered.
	expect(read(groupThread(chat, { laneId: 'Engineer', questionId: 'u1', userName: 'Captain' }))).toEqual(['user Captain: Plan the app'])
})

test('a lane joining a round after it (Answer) sees every answer given so far', () => {
	expect(read(groupThread(chat, { laneId: 'Critic', questionId: 'u2', userName: 'Captain' })).slice(-3)).toEqual([
		'user Captain: Next step',
		'user Designer: Draw the screens',
		'user Engineer: Build the screens',
	])
})

test('summaries pass through; a message with only files still names its writer; empty answers are left out', () => {
	const thread = groupThread([
		{ id: 's1', role: 'system', parts: [{ type: 'text', text: 'Summary so far' }] },
		{ id: 'u3', role: 'user', parts: [{ type: 'file', mediaType: 'image/png', url: 'x' }] },
		{ ...answer('e3', 'u3', 'Engineer', ''), parts: [{ type: 'reasoning', text: 'only thinking' }] },
	], { laneId: 'Designer', questionId: 'u3', userName: 'Captain' })
	expect(read(thread)).toEqual(['system Summary so far', 'user Captain: [file]'])
	// Without a question (for /compact): the whole thread.
	expect(read(groupThread(chat, { laneId: 'Engineer', userName: 'Captain' })).length).toBe(6)
})
