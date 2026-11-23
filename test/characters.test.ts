import { expect, test } from 'bun:test'
import { fillPlaceholders, laneIdentity } from '../shared/utils/character'
import { greetingMessages } from '../server/utils/chat/greetings'

const lane = { name: null, color: null, systemPrompt: 'Answer as {{char}} would.' }

test('placeholders: {{char}} and {{user}} in any case and spacing; other braces stay', () => {
	expect(fillPlaceholders('{{char}} helps {{ User }}; {{CHAR}} again. {{other}} {char}', { char: 'Engineer', user: 'Ana' }))
		.toBe('Engineer helps Ana; Engineer again. {{other}} {char}')
})

test('a lane without a Character keeps its own prompt and name; the model\'s name stands in for an unnamed lane', () => {
	const identity = laneIdentity({ lane, modelName: 'GPT-5 Mini', userName: 'Ana' })
	expect(identity.systemPrompt).toBe('Answer as GPT-5 Mini would.')
	expect(identity.names).toEqual({ char: 'GPT-5 Mini', user: 'Ana' })
	expect(identity.promptLabel).toBe('System prompt')
	expect(identity.aboutUser).toBeUndefined()
})

test('a Character replaces the prompt, the name and (unless the lane has one) the colour; the user\'s Character names {{user}}', () => {
	const identity = laneIdentity({
		lane: { ...lane, name: 'My lane' },
		character: { name: 'Engineer', color: 'blue', instructions: 'You are {{char}}. Help {{user}} ship.' },
		userCharacter: { name: 'Captain', instructions: '{{user}} leads the team and likes short answers.' },
		modelName: 'GPT-5 Mini',
		userName: 'Ana',
	})
	expect(identity.systemPrompt).toBe('You are Engineer. Help Captain ship.')
	expect(identity.names).toEqual({ char: 'Engineer', user: 'Captain' })
	expect(identity.color).toBe('blue')
	expect(identity.promptLabel).toBe('Character Engineer')
	expect(identity.aboutUser).toBe('The user is Captain.\nCaptain leads the team and likes short answers.')
})

test('a Character with no instructions leaves the default instructions, not the lane\'s prompt', () => {
	const identity = laneIdentity({ lane, character: { name: 'Quiet', color: null, instructions: '  ' }, modelName: 'M', userName: 'Ana' })
	expect(identity.systemPrompt).toBeNull()
})

test('a Character\'s example dialogue and closing note are filled like its instructions; empty ones are left out', () => {
	const identity = laneIdentity({
		lane,
		character: { name: 'Wren', color: null, instructions: 'You are {{char}}.', examples: '{{user}}: Where to?\n{{char}}: North.', note: 'Stay {{char}}; {{user}} is listening.' },
		userCharacter: { name: 'Captain', instructions: '' },
		modelName: 'M',
		userName: 'Ana',
	})
	expect(identity.examples).toBe('Captain: Where to?\nWren: North.')
	expect(identity.closingNote).toBe('Stay Wren; Captain is listening.')
	expect(laneIdentity({ lane, character: { name: 'Q', color: null, instructions: '', examples: ' ', note: '' }, modelName: 'M', userName: 'Ana' }))
		.toMatchObject({ examples: undefined, closingNote: undefined })
})

test('greetings: every answering lane\'s Character greets, filled, the first shown; in a group only the first lane', () => {
	const characters = { w: { name: 'Wren', color: 'blue' as const, greetings: ['Hi {{user}}, I am {{char}}.', 'Back again, {{user}}?'] }, q: { name: 'Quiet', color: null, greetings: [] }, b: { name: 'Bard', color: null, greetings: ['A song!'] } }
	const lanes = [
		{ id: 'l0', enabled: true, color: null, characterId: 'q' },
		{ id: 'l1', enabled: true, color: 'red' as const, characterId: 'w' },
		{ id: 'l2', enabled: false, color: null, characterId: 'b' },
		{ id: 'l3', enabled: true, color: null, characterId: 'b' },
	]
	const written = greetingMessages({ chatId: 'c', lanes, characters, userName: 'Ana', group: false })
	expect(written.map(({ chatModelId, active, parts, parentId, metadata }) => ({ chatModelId, active, text: parts[0]!.text, parentId, metadata }))).toEqual([
		{ chatModelId: 'l1', active: true, text: 'Hi Ana, I am Wren.', parentId: null, metadata: { greeting: true, lane: { name: 'Wren', color: 'red' } } },
		{ chatModelId: 'l1', active: false, text: 'Back again, Ana?', parentId: null, metadata: { greeting: true, lane: { name: 'Wren', color: 'red' } } },
		{ chatModelId: 'l3', active: true, text: 'A song!', parentId: null, metadata: { greeting: true, lane: { name: 'Bard', color: null } } },
	])
	expect(greetingMessages({ chatId: 'c', lanes, characters, userName: 'Ana', group: true }).map(message => message.chatModelId)).toEqual(['l1', 'l1'])
})
