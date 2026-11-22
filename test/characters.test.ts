import { expect, test } from 'bun:test'
import { fillPlaceholders, laneIdentity } from '../shared/utils/character'

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
