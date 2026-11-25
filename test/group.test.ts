import { expect, test } from 'bun:test'
import type { UIMessage } from 'ai'
import type { MessageMetadata } from '../shared/utils/chat'
import { MAX_SHARED_CHART, groupThread, namedSenders } from '../server/utils/chat/group'

type Stored = UIMessage<MessageMetadata> & { chatModelId?: string | null, parentId?: string | null, userId?: string | null }

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

test('the others\' charts come as JSON in place, cut when long; failed charts and other tools stay out', () => {
	const chart = (input: object, state = 'output-available') => ({ type: 'tool-chart', toolCallId: 'c', state, input, output: input }) as unknown as Stored['parts'][number]
	const sales = { title: 'Sales', type: 'bar', xKey: 'month', data: [{ month: 'Jan', total: 3 }], series: [{ key: 'total', name: 'Total', color: '#000' }] }
	const big = { title: 'Big', data: Array.from({ length: 500 }, (_, day) => ({ day, value: day * 2 })) }
	const thread = groupThread([
		user('u1', 'Show sales', ['Engineer', 'Designer']),
		{
			...answer('e1', 'u1', 'Engineer', ''),
			parts: [
				{ type: 'text', text: 'Here it is.' },
				chart(sales),
				chart(big),
				chart({ title: 'Broken' }, 'output-error'),
				{ type: 'tool-read_file', toolCallId: 'r', state: 'output-available', input: { path: 'a' }, output: 'secret' } as unknown as Stored['parts'][number],
				{ type: 'text', text: 'Rising.' },
			],
		},
		// An answer that is only a chart still reaches the others.
		{ ...answer('d0', 'u1', 'Critic', ''), parts: [chart(sales)] },
	], { laneId: 'Reviewer', questionId: 'u1', userName: 'Captain' })
	const [, engineer, critic] = read(thread)
	expect(engineer).toStartWith(`user Engineer: Here it is.\n\n[chart] ${JSON.stringify(sales)}\n\n[chart] `)
	expect(engineer).toEndWith('… (cut)\n\nRising.')
	expect(engineer).toContain(JSON.stringify(big).slice(0, MAX_SHARED_CHART))
	expect(engineer).not.toContain(JSON.stringify(big))
	expect(engineer).not.toContain('Broken')
	expect(engineer).not.toContain('secret')
	expect(critic).toBe(`user Critic: [chart] ${JSON.stringify(sales)}`)
})

test('another speaker\'s image: its prompt in the text, and the image itself for a speaker whose model reads images', () => {
	const image = { fileId: 'f1', url: '/api/v1/files/f1', mediaType: 'image/webp', prompt: 'a red fox' }
	const drew: Stored[] = [
		user('u1', 'Draw a fox', ['Painter', 'Critic']),
		{
			...answer('p1', 'u1', 'Painter', ''),
			parts: [
				{ type: 'text', text: 'Done.' },
				{ type: 'tool-generate_image', toolCallId: 'i1', state: 'output-available', input: { prompt: 'a red fox' }, output: image },
				{ type: 'tool-generate_image', toolCallId: 'i2', state: 'output-error', input: { prompt: 'a blue fox' }, errorText: 'no' },
			] as Stored['parts'],
		},
	]
	const seeing = groupThread(drew, { laneId: 'Critic', questionId: 'u1', userName: 'Captain', seesImages: true })
	expect(seeing[1]!.parts).toEqual([{ type: 'text', text: 'Painter: Done.\n\n[image: a red fox]' }, { type: 'file', url: '/api/v1/files/f1', mediaType: 'image/webp' }])
	const blind = groupThread(drew, { laneId: 'Critic', questionId: 'u1', userName: 'Captain' })
	expect(read(blind)).toEqual(['user Captain: Draw a fox', 'user Painter: Done.\n\n[image: a red fox]'])
})

test('a greeting opens the shared thread: the greeter\'s own, the others\' under its name', () => {
	const greeted: Stored[] = [{ id: 'g', role: 'assistant', parentId: null, chatModelId: 'Bard', metadata: { greeting: true, lane: { name: 'Bard', color: null } }, parts: [{ type: 'text', text: 'Welcome, traveller.' }] }, user('u1', 'Hello', ['Bard', 'Guard'])]
	expect(read(groupThread(greeted, { laneId: 'Bard', questionId: 'u1', userName: 'Captain' }))).toEqual(['assistant Welcome, traveller.', 'user Captain: Hello'])
	expect(read(groupThread(greeted, { laneId: 'Guard', questionId: 'u1', userName: 'Captain' }))).toEqual(['user Bard: Welcome, traveller.', 'user Captain: Hello'])
})

test('a lane\'s thread names senders only once more than one person writes; the owner goes by `{{user}}`', () => {
	const names = { owner: 'Captain', editor: 'Mira' }
	const sent = (id: string, text: string, userId: string | null): Stored => ({ ...user(id, text), userId })
	const alone = [sent('u1', 'Hi', 'owner'), answer('a1', 'u1', 'Designer', 'Hello'), sent('u2', 'More', 'owner')]
	// One sender: unchanged, the same objects.
	expect(namedSenders(alone, names)).toBe(alone)
	const together = [sent('u1', 'Hi', 'owner'), answer('a1', 'u1', 'Designer', 'Hello'), sent('u2', 'And me', 'editor'), sent('u3', 'Old', null)]
	expect(read(namedSenders(together, names))).toEqual(['user Captain: Hi', 'assistant [reasoning] Hello', 'user Mira: And me', 'user Someone: Old'])
})

test('a group thread names each user message by its sender when names are given, else as the user', () => {
	const round = [{ ...user('u1', 'Plan it', ['Designer']), userId: 'owner' }, answer('d1', 'u1', 'Designer', 'Blue'), { ...user('u2', 'Agreed', ['Designer']), userId: 'editor' }]
	expect(read(groupThread(round, { laneId: 'Designer', userName: 'Captain', names: { owner: 'Captain', editor: 'Mira' } })))
		.toEqual(['user Captain: Plan it', 'assistant [reasoning] Blue', 'user Mira: Agreed'])
	expect(read(groupThread(round, { laneId: 'Designer', userName: 'Captain' })))
		.toEqual(['user Captain: Plan it', 'assistant [reasoning] Blue', 'user Captain: Agreed'])
})
