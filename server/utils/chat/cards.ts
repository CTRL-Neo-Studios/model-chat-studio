import { createError } from 'nuxt/server'
import { z } from 'zod'
// Relative, not `#shared`, so this module also loads in `bun test`.
import { CHARACTER_TEXT_MAX, type CharacterFields } from '../../../shared/utils/character'

/** The most entries a card's lorebook may have. */
export const MAX_LOREBOOK_ENTRIES = 500

const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
const CARD_CHUNKS = ['ccv3', 'chara']

const refuse = (statusText: string) => createError({ status: 400, statusText })

/** A PNG's chunks, as views on the file: no image decoding, and the CRCs are not checked. */
function pngChunks(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	const chunks: { type: string, start: number, end: number, data: Uint8Array }[] = []
	for (let at = 8; at + 12 <= bytes.length;) {
		const length = view.getUint32(at)
		const end = at + 12 + length
		if (end > bytes.length) throw refuse('The PNG is cut short')
		const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
		chunks.push({ type, start: at, end, data: bytes.subarray(at + 8, at + 8 + length) })
		at = end
		if (type === 'IEND') break
	}
	return chunks
}

/** A tEXt chunk's keyword and text (Latin-1). */
function textChunk(data: Uint8Array) {
	const zero = data.indexOf(0)
	const latin1 = new TextDecoder('latin1')
	return zero === -1 ? undefined : { keyword: latin1.decode(data.subarray(0, zero)), text: latin1.decode(data.subarray(zero + 1)) }
}

/**
 * A card file's JSON, and for a PNG the image without its card chunks. A PNG carries the card base64-encoded in a
 * `tEXt` chunk: `ccv3` when present, else `chara`; which version it is comes from the JSON, not the chunk's name.
 */
export function readCardFile(bytes: Uint8Array) {
	if (PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
		const chunks = pngChunks(bytes)
		const texts = Object.fromEntries(chunks.flatMap(chunk => chunk.type === 'tEXt' ? [textChunk(chunk.data)].flatMap(text => text ? [[text.keyword, text.text]] : []) : []))
		const encoded = CARD_CHUNKS.map(name => texts[name]).find(Boolean)
		if (!encoded) throw refuse('This PNG has no character card in it')
		let card: unknown
		try {
			card = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded), char => char.charCodeAt(0))))
		}
		catch {
			throw refuse('The card in this PNG could not be read')
		}
		// The image as an avatar: every chunk but the card's, as they were.
		const kept = chunks.filter(chunk => !(chunk.type === 'tEXt' && CARD_CHUNKS.includes(textChunk(chunk.data)?.keyword ?? '')))
		const image = new Uint8Array(8 + kept.reduce((total, chunk) => total + chunk.end - chunk.start, 0))
		image.set(PNG_SIGNATURE)
		let at = 8
		for (const chunk of kept) {
			image.set(bytes.subarray(chunk.start, chunk.end), at)
			at += chunk.end - chunk.start
		}
		return { card, image }
	}
	try {
		return { card: JSON.parse(new TextDecoder().decode(bytes)) as unknown, image: undefined }
	}
	catch {
		throw refuse('Not a character card: a PNG with a card in it, or a card\'s JSON')
	}
}

const text = z.string().optional()
const cardFieldsSchema = z.looseObject({
	name: z.string(),
	description: text,
	personality: text,
	scenario: text,
	first_mes: text,
	mes_example: text,
	system_prompt: text,
	post_history_instructions: text,
	creator_notes: text,
	alternate_greetings: z.array(z.string()).optional(),
	tags: z.array(z.string()).optional(),
	character_book: z.looseObject({ entries: z.array(z.unknown()) }).optional(),
	group_only_greetings: z.array(z.string()).optional(),
	assets: z.array(z.unknown()).optional(),
	extensions: z.record(z.string(), z.unknown()).optional(),
})

/** Fields a Character holds itself (the lorebook becomes a library); every other one of a card's `data` is kept in `card`, as it came. */
const MAPPED = ['name', 'description', 'personality', 'scenario', 'first_mes', 'alternate_greetings', 'mes_example', 'system_prompt', 'post_history_instructions', 'creator_notes', 'tags', 'character_book']

/** Line ends as LF, and V1's `<USER>` and `<BOT>` as `{{user}}` and `{{char}}`. */
const clean = (value: string | undefined) => (value ?? '').replace(/\r\n?/g, '\n').replace(/<USER>/gi, '{{user}}').replace(/<BOT>/gi, '{{char}}').trim()

const isEmpty = (value: unknown) => value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length) || (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length)

/**
 * A card as a Character (plan section 2): the system prompt, description, personality and scenario as one set of
 * instructions; the first message and alternate greetings as greetings; example dialogue, closing note, creator's
 * notes and tags. The card's other fields are kept as they came (`card`), and `report` says what was converted or
 * is not used here. `book` is the card's lorebook, for `cardBookToLorebook`. V1 cards are their own `data`. A text
 * over its limit refuses the import, naming the field.
 */
export function cardToCharacter(raw: unknown) {
	const root = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
	const spec = root.spec === 'chara_card_v2' || root.spec === 'chara_card_v3' ? root.spec : 'v1'
	const parsed = cardFieldsSchema.safeParse(spec === 'v1' ? root : root.data)
	if (!parsed.success) {
		const field = parsed.error.issues[0]?.path.join('.')
		throw refuse(field === 'name' || !field ? 'Not a character card: it has no name' : `The card's \`${field}\` is not what a card holds there`)
	}
	const data = parsed.data
	const report: string[] = []
	const v1Placeholders = /<(?:USER|BOT)>/i.test(JSON.stringify(data))

	const personality = clean(data.personality)
	const scenario = clean(data.scenario)
	const fields: Omit<CharacterFields, 'color' | 'libraryIds'> = {
		name: clean(data.name),
		instructions: [clean(data.system_prompt), clean(data.description), personality && `Personality: ${personality}`, scenario && `Scenario: ${scenario}`].filter(Boolean).join('\n\n'),
		greetings: [data.first_mes, ...(data.alternate_greetings ?? [])].map(clean).filter(Boolean),
		examples: clean(data.mes_example),
		note: clean(data.post_history_instructions),
		creatorNotes: clean(data.creator_notes) || clean(typeof root.creatorcomment === 'string' ? root.creatorcomment : ''),
		tags: [...new Set((data.tags ?? []).map(tag => tag.trim()).filter(tag => tag && tag.length <= 50))].slice(0, 50),
	}

	if (!fields.name) throw refuse('Not a character card: it has no name')
	if (fields.name.length > 60) throw refuse(`The card's name is ${fields.name.length} characters long; a Character's name is at most 60`)
	const over = ([['instructions', fields.instructions], ['examples (mes_example)', fields.examples], ['closing note (post_history_instructions)', fields.note], ['creator\'s notes', fields.creatorNotes], ...fields.greetings.map((greeting, index) => [`greeting ${index + 1}`, greeting])] as const)
		.find(([, value]) => value.length > CHARACTER_TEXT_MAX)
	if (over) throw refuse(`The card's ${over[0]} is ${over[1].length.toLocaleString('en-US')} characters long; at most ${CHARACTER_TEXT_MAX.toLocaleString('en-US')} fit`)
	if (fields.greetings.length > 50) throw refuse(`The card has ${fields.greetings.length} greetings; a Character has at most 50`)
	const entries = data.character_book?.entries.length ?? 0
	if (entries > MAX_LOREBOOK_ENTRIES) throw refuse(`The card's lorebook has ${entries} entries; at most ${MAX_LOREBOOK_ENTRIES} are imported`)

	if (personality || scenario) report.push('Its personality and scenario were joined into the instructions.')
	if (v1Placeholders) report.push('Its old placeholders <USER> and <BOT> were written as {{user}} and {{char}}.')
	if ((data.tags?.length ?? 0) > fields.tags.length) report.push('Tags over 50 characters, repeated, or past the 50th were left out.')
	if (data.group_only_greetings?.length) report.push(`Its ${data.group_only_greetings.length} group-only greetings are kept with the card, not used: a group here opens with the first greeting.`)
	if (data.assets?.length) report.push(`Its ${data.assets.length} assets (V3) are kept with the card and not fetched.`)
	const depthPrompt = data.extensions?.depth_prompt
	if (typeof depthPrompt === 'object' && depthPrompt !== null && typeof (depthPrompt as { prompt?: unknown }).prompt === 'string' && (depthPrompt as { prompt: string }).prompt.trim()) {
		report.push('Its character\'s note (SillyTavern\'s depth prompt) is kept with the card, not sent.')
	}

	const card = Object.fromEntries(Object.entries(data).filter(([key, value]) => !MAPPED.includes(key) && !isEmpty(value)))
	return { fields, card: { spec, ...(Object.keys(card).length && { data: card }) }, book: entries ? data.character_book : undefined, report }
}
