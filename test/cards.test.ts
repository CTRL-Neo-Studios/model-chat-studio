import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { cardToCharacter, readCardFile } from '../server/utils/chat/cards'

const testdata = (name: string) => new Uint8Array(readFileSync(new URL(`../scripts/testdata/${name}`, import.meta.url)))

/** A 1×1 PNG with text chunks; the reader does not check CRCs, so they are left zero. */
function png(texts: Record<string, string>) {
	const chunk = (type: string, data: Uint8Array) => {
		const bytes = new Uint8Array(12 + data.length)
		new DataView(bytes.buffer).setUint32(0, data.length)
		bytes.set(new TextEncoder().encode(type), 4)
		bytes.set(data, 8)
		return bytes
	}
	const latin1 = (value: string) => Uint8Array.from(value, char => char.charCodeAt(0))
	const parts = [
		new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
		chunk('IHDR', new Uint8Array(13)),
		...Object.entries(texts).map(([keyword, text]) => chunk('tEXt', latin1(`${keyword}\0${text}`))),
		chunk('IDAT', new Uint8Array(4)),
		chunk('IEND', new Uint8Array(0)),
	]
	const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
	parts.reduce((at, part) => (out.set(part, at), at + part.length), 0)
	return out
}
const base64 = (value: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))

const v2 = {
	spec: 'chara_card_v2',
	spec_version: '2.0',
	data: {
		name: 'Wren',
		description: 'A travel guide.\r\nShe knows the roads.',
		personality: 'Warm, blunt',
		scenario: 'A crossroads inn',
		first_mes: 'You made it, {{user}}.',
		alternate_greetings: ['Back again?', ''],
		mes_example: '<START>\n{{user}}: Where to?\n{{char}}: North.',
		system_prompt: 'Stay in the story.',
		post_history_instructions: 'Keep it short.',
		creator_notes: 'Made for testing.',
		tags: ['guide', 'guide', 'x'.repeat(51)],
		creator: 'me',
		character_version: '1',
		extensions: { depth_prompt: { prompt: 'Speak softly.', depth: 4, role: 'system' }, world: '' },
		character_book: { entries: [{ keys: ['inn'], content: 'The inn is old.' }] },
	},
}

test('a V2 card: its texts become the Character, its other fields are kept, and the report says what changed', () => {
	const { fields, card, report } = cardToCharacter(v2)
	expect(fields).toEqual({
		name: 'Wren',
		instructions: 'Stay in the story.\n\nA travel guide.\nShe knows the roads.\n\nPersonality: Warm, blunt\n\nScenario: A crossroads inn',
		greetings: ['You made it, {{user}}.', 'Back again?'],
		examples: '<START>\n{{user}}: Where to?\n{{char}}: North.',
		note: 'Keep it short.',
		creatorNotes: 'Made for testing.',
		tags: ['guide'],
	})
	expect(card).toEqual({ spec: 'chara_card_v2', data: { creator: 'me', character_version: '1', extensions: v2.data.extensions, character_book: v2.data.character_book } })
	expect(report).toEqual([
		'Its personality and scenario were joined into the instructions.',
		'Tags over 50 characters, repeated, or past the 50th were left out.',
		'Its lorebook (1 entry) is kept with the card; it becomes a lorebook library in a later step of this milestone.',
		'Its character\'s note (SillyTavern\'s depth prompt) is kept with the card, not sent.',
	])
})

test('a V1 card is its own data; <USER> and <BOT> become {{user}} and {{char}}', () => {
	const { fields, card, report } = cardToCharacter({ name: 'Old', description: '<BOT> greets <user>.', personality: '', scenario: '', first_mes: 'Hi <USER>', mes_example: '' })
	expect(fields).toMatchObject({ name: 'Old', instructions: '{{char}} greets {{user}}.', greetings: ['Hi {{user}}'] })
	expect(card).toEqual({ spec: 'v1' })
	expect(report).toEqual(['Its old placeholders <USER> and <BOT> were written as {{user}} and {{char}}.'])
})

test('your V3 card, as JSON and as PNG: the same Character; the PNG\'s image comes without its card chunks', () => {
	const json = readCardFile(testdata('Ignathius (UT).json'))
	const fromPng = readCardFile(testdata('Ignathius (UT).png'))
	expect(json.image).toBeUndefined()
	const character = cardToCharacter(json.card)
	expect(cardToCharacter(fromPng.card)).toEqual(character)
	expect(character.fields.name).toBe('Ignathius (UT)')
	expect(character.fields.instructions).toStartWith('[{{user}} name(Ignathius Emberfall);\n{{user}} personality(')
	expect(character.fields.instructions).not.toContain('\r')
	expect(character.card.spec).toBe('chara_card_v3')
	// Two chunks of about 7 KB each are gone; the image still reads as a PNG without a card in it.
	const image = fromPng.image!
	expect(testdata('Ignathius (UT).png').length - image.length).toBeGreaterThan(14_000)
	expect(() => readCardFile(image)).toThrow('This PNG has no character card in it')
})

test('a PNG with only the `chara` chunk is read; with both, `ccv3` wins', () => {
	expect(cardToCharacter(readCardFile(png({ chara: base64(v2) })).card).fields.name).toBe('Wren')
	const both = png({ chara: base64({ ...v2, data: { ...v2.data, name: 'Old name' } }), ccv3: base64({ ...v2, spec: 'chara_card_v3', data: { ...v2.data, name: 'New name' } }) })
	expect(cardToCharacter(readCardFile(both).card).fields.name).toBe('New name')
})

test('what is not a card, or does not fit, is refused with the reason', () => {
	expect(() => readCardFile(new Uint8Array([1, 2, 3]))).toThrow('Not a character card')
	expect(() => readCardFile(png({ Comment: 'hello' }))).toThrow('This PNG has no character card in it')
	expect(() => readCardFile(png({ chara: '%%%' }))).toThrow('could not be read')
	expect(() => cardToCharacter({ hello: 'world' })).toThrow('it has no name')
	expect(() => cardToCharacter({ ...v2, data: { ...v2.data, alternate_greetings: 'not a list' } })).toThrow('`alternate_greetings`')
	expect(() => cardToCharacter({ ...v2, data: { ...v2.data, description: 'x'.repeat(50_001) } })).toThrow('instructions')
	expect(() => cardToCharacter({ ...v2, data: { ...v2.data, name: 'n'.repeat(61) } })).toThrow('at most 60')
	const entries = Array.from({ length: 501 }, (_, index) => ({ keys: [`k${index}`], content: 'x' }))
	expect(() => cardToCharacter({ ...v2, data: { ...v2.data, character_book: { entries } } })).toThrow('501 entries')
})
