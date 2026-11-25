// Relative, not `#shared`, so this module also loads in `bun test`.
import { type Lore, type Lorebook, LORE_ROLES, loreSchema } from '../../../shared/utils/lorebook'

type Json = Record<string, unknown>

const MAX_KEYS = 20
const MAX_KEY_LENGTH = 50
const MAX_NAME_LENGTH = 255

const object = (value: unknown): Json => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : {}
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
const integer = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined
const clean = (value: unknown) => (typeof value === 'string' ? value : '').replace(/\r\n?/g, '\n').replace(/<USER>/gi, '{{user}}').replace(/<BOT>/gi, '{{char}}').trim()
const isEmpty = (value: unknown) => value === undefined || value === null || value === '' || value === false || value === 0
	|| (Array.isArray(value) && !value.length) || (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value as object).length)
const clamp = (value: number | undefined, min: number, max: number) => value === undefined ? undefined : Math.min(max, Math.max(min, value))

/** SillyTavern's numbers for an entry's position, "also needs" logic and role. */
const ST_POSITION = { before: 0, after: 1, authorsNoteTop: 2, authorsNoteBottom: 3, depth: 4, examplesTop: 5, examplesBottom: 6, outlet: 7 }
const ST_LOGIC = ['andAny', 'notAll', 'notAny', 'andAll'] as const

/** An entry's fields the app holds (its `id` is its place, numbered again on export); any other one is kept as it came. */
const ENTRY_FIELDS = ['id', 'keys', 'content', 'enabled', 'insertion_order', 'case_sensitive', 'name', 'priority', 'comment', 'selective', 'secondary_keys', 'constant', 'position', 'extensions']
const EXTENSION_FIELDS = ['position', 'depth', 'role', 'selectiveLogic', 'probability', 'useProbability', 'group', 'group_override', 'group_weight', 'use_group_scoring', 'prevent_recursion', 'exclude_recursion', 'delay_until_recursion', 'scan_depth', 'case_sensitive', 'match_whole_words', 'vectorized', 'sticky', 'cooldown', 'delay', 'match_character_description', 'match_character_personality', 'match_scenario', 'match_persona_description']
/** Kept fields nobody needs told about: they only order or tag entries in SillyTavern's editor. */
const QUIET = ['uid', 'display_index', 'use_regex', 'addMemo']
const BOOK_FIELDS = ['name', 'description', 'scan_depth', 'token_budget', 'recursive_scanning', 'entries']

function keep(source: Json, mapped: string[]) {
	return Object.fromEntries(Object.entries(source).filter(([key, value]) => !mapped.includes(key) && value !== undefined))
}

/** A unique note name, from the entry's comment, else its name, else its first keyword. */
function noteName(entry: Json, keys: string[], index: number, used: Record<string, true>) {
	const base = (clean(entry.comment) || clean(entry.name) || keys[0] || `Entry ${index + 1}`)
		.replace(/\s+/g, ' ').replace(/\//g, '-').slice(0, MAX_NAME_LENGTH - 6).trim()
	const safe = base === '.' || base === '..' || !base ? `Entry ${index + 1}` : base
	let name = safe
	for (let n = 2; used[name.toLowerCase()]; n++) name = `${safe} (${n})`
	used[name.toLowerCase()] = true
	return name
}

/**
 * A card's `character_book` as a lorebook library: the book's options (plan section 2b), one note per entry with its
 * keywords as tags and its options as `lore`, and what was converted or is not used here. Fields the app does not
 * use are kept with the book and each note, for export.
 */
export function cardBookToLorebook(rawBook: unknown) {
	const book = object(rawBook)
	const report: string[] = []
	const counts = { keysLeftOut: 0, regex: 0, authorsNote: 0, outlet: 0, vectorized: 0, instructions: 0, persona: 0 }
	const unused: Record<string, true> = {}
	const used: Record<string, true> = {}

	const notes = (Array.isArray(book.entries) ? book.entries : Object.values(object(book.entries))).map((raw, index) => {
		const entry = object(raw)
		const ext = object(entry.extensions)
		const allKeys = strings(entry.keys).map(key => key.trim()).filter(Boolean)
		const keys = [...new Set(allKeys.filter(key => key.length <= MAX_KEY_LENGTH))].slice(0, MAX_KEYS)
		counts.keysLeftOut += allKeys.length - keys.length
		counts.regex += [...allKeys, ...strings(entry.secondary_keys)].filter(key => /^\/.+\/[a-z]*$/.test(key)).length

		const lore: Lore = {}
		const kept: Json = keep(entry, ENTRY_FIELDS)
		const keptExtensions: Json = keep(ext, EXTENSION_FIELDS)

		if (entry.enabled === false) lore.enabled = false
		if (entry.constant === true) lore.constant = true
		const secondary = [...new Set(strings(entry.secondary_keys).map(key => key.trim()).filter(key => key && key.length <= 100))].slice(0, 50)
		if (secondary.length && entry.selective !== false) {
			lore.secondaryKeys = secondary
			const logic = ST_LOGIC[integer(ext.selectiveLogic) ?? 0] ?? 'andAny'
			if (logic !== 'andAny') lore.logic = logic
		}
		else if (secondary.length) Object.assign(kept, { selective: false, secondary_keys: secondary })
		const caseSensitive = ext.case_sensitive ?? entry.case_sensitive
		if (typeof caseSensitive === 'boolean') lore.caseSensitive = caseSensitive
		if (typeof ext.match_whole_words === 'boolean') lore.wholeWords = ext.match_whole_words
		const scanDepth = clamp(integer(ext.scan_depth), 0, 100)
		if (scanDepth !== undefined) lore.scanDepth = scanDepth
		const order = clamp(integer(entry.insertion_order), -1_000_000, 1_000_000)
		if (order !== undefined && order !== 100) lore.order = order
		const priority = clamp(integer(entry.priority), -1_000_000, 1_000_000)
		if (priority !== undefined) lore.priority = priority

		// Where it goes: SillyTavern's number when there is one, else the card's `position`.
		const position = integer(ext.position) ?? (entry.position === 'before_char' ? ST_POSITION.before : entry.position === 'after_char' ? ST_POSITION.after : undefined)
		if (position === ST_POSITION.before) lore.position = 'before'
		else if (position === ST_POSITION.after || position === ST_POSITION.examplesTop || position === ST_POSITION.examplesBottom) lore.position = 'after'
		else if (position === ST_POSITION.depth) {
			lore.position = 'depth'
			lore.depth = clamp(integer(ext.depth), 0, 1000) ?? 4
			lore.role = LORE_ROLES[integer(ext.role) ?? 0] ?? 'system'
		}
		else if (position === ST_POSITION.authorsNoteTop || position === ST_POSITION.authorsNoteBottom) {
			Object.assign(lore, { position: 'depth', depth: 4, role: 'system' })
			counts.authorsNote++
		}
		else if (position === ST_POSITION.outlet) {
			keptExtensions.position = position
			counts.outlet++
		}

		if (ext.prevent_recursion) lore.preventRecursion = true
		if (ext.exclude_recursion) lore.excludeRecursion = true
		if (ext.delay_until_recursion) lore.delayUntilRecursion = true
		const group = typeof ext.group === 'string' ? ext.group.trim().slice(0, 200) : ''
		if (group) {
			lore.group = group
			if (ext.group_override === true) lore.groupOverride = true
			const weight = clamp(integer(ext.group_weight), 1, 10_000)
			if (weight !== undefined && weight !== 100) lore.groupWeight = weight
			if (ext.use_group_scoring === true) lore.groupScoring = true
		}
		const probability = clamp(integer(ext.probability), 0, 100)
		if (ext.useProbability !== false && probability !== undefined && probability < 100) lore.probability = probability
		for (const key of ['sticky', 'cooldown', 'delay'] as const) {
			const value = clamp(integer(ext[key]), 0, 1000)
			if (value) lore[key] = value
		}
		if (ext.vectorized === true) {
			lore.fuzzy = true
			counts.vectorized++
		}
		if (ext.match_character_description === true || ext.match_character_personality === true || ext.match_scenario === true) {
			lore.scanInstructions = true
			counts.instructions++
		}
		if (ext.match_persona_description === true) {
			lore.scanUserCharacter = true
			counts.persona++
		}

		for (const [key, value] of [...Object.entries(kept), ...Object.entries(keptExtensions)]) {
			if (!QUIET.includes(key) && !isEmpty(value) && key !== 'position') unused[key] = true
		}
		if (Object.keys(keptExtensions).length) kept.extensions = keptExtensions
		if (Object.keys(kept).length) lore.kept = kept
		return { name: noteName(entry, keys, index, used), tags: keys, content: clean(entry.content), lore: loreSchema.parse(lore) }
	})

	const lorebook: Lorebook = { on: true }
	const scanDepth = clamp(integer(book.scan_depth), 0, 100)
	if (scanDepth !== undefined) lorebook.scanDepth = scanDepth
	const tokens = integer(book.token_budget)
	if (tokens) {
		lorebook.maxChars = clamp(tokens * 4, 100, 500_000)
		report.push(`Its token budget of ${tokens.toLocaleString('en-US')} became ${lorebook.maxChars!.toLocaleString('en-US')} characters.`)
	}
	if (book.recursive_scanning === true) lorebook.recursive = true
	const bookKept = keep(book, BOOK_FIELDS)
	if (Object.keys(bookKept).length) lorebook.kept = bookKept

	if (counts.keysLeftOut) report.push(`${counts.keysLeftOut} lorebook ${counts.keysLeftOut === 1 ? 'keyword was' : 'keywords were'} left out: over ${MAX_KEY_LENGTH} characters, repeated, or past the ${MAX_KEYS}th of an entry.`)
	if (counts.regex) report.push(`${counts.regex} lorebook ${counts.regex === 1 ? 'keyword is a regular expression' : 'keywords are regular expressions'}: matched as plain text here.`)
	if (counts.authorsNote) report.push(`${counts.authorsNote} lorebook ${counts.authorsNote === 1 ? 'entry' : 'entries'} placed at the author's note ${counts.authorsNote === 1 ? 'goes' : 'go'} 4 messages up, as system: there is no author's note here.`)
	if (counts.outlet) report.push(`${counts.outlet} lorebook ${counts.outlet === 1 ? 'entry' : 'entries'} with an outlet position ${counts.outlet === 1 ? 'goes' : 'go'} with auto-fetched files: there are no outlets here.`)
	if (counts.vectorized) report.push(`${counts.vectorized} lorebook ${counts.vectorized === 1 ? 'entry' : 'entries'} matched by meaning (vectorized) ${counts.vectorized === 1 ? 'is' : 'are'} also matched by the words of ${counts.vectorized === 1 ? 'its' : 'their'} text.`)
	if (counts.instructions) report.push(`${counts.instructions} lorebook ${counts.instructions === 1 ? 'entry also searches' : 'entries also search'} the Character's instructions, which hold its description, personality and scenario.`)
	if (counts.persona) report.push(`${counts.persona} lorebook ${counts.persona === 1 ? 'entry also searches' : 'entries also search'} the user's Character, in place of the persona.`)
	const unusedNames = Object.keys(unused)
	if (unusedNames.length) report.push(`Lorebook options kept for export but not used here: ${unusedNames.join(', ')}.`)

	return {
		name: clean(book.name).slice(0, 100) || undefined,
		description: clean(book.description).slice(0, 2000) || undefined,
		lorebook,
		notes,
		report,
	}
}

/**
 * A lorebook library as a card's `character_book` (V2, with SillyTavern's options in `extensions`), the way
 * `cardBookToLorebook` reads it, kept fields merged back.
 */
export function lorebookToCardBook(library: { name: string, description: string | null, lorebook: Lorebook | null }, notes: { name: string, tags: string[], content: string | null, lore: Lore | null }[]) {
	const book = library.lorebook ?? { on: true }
	return {
		...book.kept,
		name: library.name,
		...(library.description && { description: library.description }),
		...(book.scanDepth != null && { scan_depth: book.scanDepth }),
		...(book.maxChars != null && { token_budget: Math.round(book.maxChars / 4) }),
		recursive_scanning: !!book.recursive,
		extensions: object(book.kept?.extensions),
		entries: notes.map((note, index) => {
			const lore = note.lore ?? {}
			const { extensions: keptExtensions, ...kept } = lore.kept ?? {}
			const position = lore.position === 'before' ? ST_POSITION.before : lore.position === 'after' ? ST_POSITION.after : lore.position === 'depth' ? ST_POSITION.depth : undefined
			const secondary = lore.secondaryKeys ?? []
			return {
				...kept,
				id: index,
				keys: note.tags,
				secondary_keys: secondary.length ? secondary : kept.secondary_keys ?? [],
				comment: note.name,
				content: note.content ?? '',
				constant: !!lore.constant,
				selective: secondary.length ? true : kept.selective ?? true,
				insertion_order: lore.order ?? 100,
				enabled: lore.enabled !== false,
				...(position !== undefined && position !== ST_POSITION.depth && { position: position === ST_POSITION.before ? 'before_char' : 'after_char' }),
				...(lore.priority != null && { priority: lore.priority }),
				...(lore.caseSensitive != null && { case_sensitive: lore.caseSensitive }),
				extensions: {
					...object(keptExtensions),
					...(position !== undefined && { position }),
					...(lore.position === 'depth' && { depth: lore.depth ?? 4, role: LORE_ROLES.indexOf(lore.role ?? 'system') }),
					selectiveLogic: ST_LOGIC.indexOf(lore.logic ?? 'andAny'),
					probability: lore.probability ?? 100,
					useProbability: true,
					group: lore.group ?? '',
					group_override: !!lore.groupOverride,
					group_weight: lore.groupWeight ?? 100,
					use_group_scoring: !!lore.groupScoring,
					prevent_recursion: !!lore.preventRecursion,
					exclude_recursion: !!lore.excludeRecursion,
					delay_until_recursion: !!lore.delayUntilRecursion,
					scan_depth: lore.scanDepth ?? null,
					case_sensitive: lore.caseSensitive ?? null,
					match_whole_words: lore.wholeWords ?? null,
					vectorized: !!lore.fuzzy,
					sticky: lore.sticky ?? 0,
					cooldown: lore.cooldown ?? 0,
					delay: lore.delay ?? 0,
					match_character_description: !!lore.scanInstructions,
					match_character_personality: !!lore.scanInstructions,
					match_scenario: !!lore.scanInstructions,
					match_persona_description: !!lore.scanUserCharacter,
				},
			}
		}),
	}
}
