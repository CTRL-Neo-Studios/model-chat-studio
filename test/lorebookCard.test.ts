import { expect, test } from 'bun:test'
import { cardBookToLorebook, lorebookToCardBook } from '../server/utils/library/lorebookCard'

// As SillyTavern exports it ("Seraphina"'s book): V2 fields, SillyTavern's own in `extensions`, defaults mostly.
const seraphina = {
	id: 0,
	keys: ['eldoria', 'wood', 'forest', 'magical forest'],
	secondary_keys: [],
	comment: 'eldoria',
	content: '{{user}}: "What is Eldoria?"\r\n{{char}}: "Here."',
	constant: false,
	selective: true,
	insertion_order: 100,
	enabled: true,
	position: 'before_char',
	use_regex: true,
	extensions: {
		position: 0, exclude_recursion: false, display_index: 0, probability: 100, useProbability: true, depth: 4, selectiveLogic: 0,
		group: '', group_override: false, group_weight: 100, prevent_recursion: false, delay_until_recursion: false, scan_depth: null,
		match_whole_words: null, use_group_scoring: false, case_sensitive: null, automation_id: '', role: 0, vectorized: false,
		sticky: 0, cooldown: 0, delay: 0,
	},
}

test('a SillyTavern entry with its defaults: keywords as tags, comment as name, position, and the rest kept quietly', () => {
	const { notes, lorebook, report, name } = cardBookToLorebook({ name: 'Eldoria', entries: [seraphina] })
	expect(name).toBe('Eldoria')
	expect(lorebook).toEqual({ on: true })
	expect(notes).toEqual([{
		name: 'eldoria',
		tags: ['eldoria', 'wood', 'forest', 'magical forest'],
		content: '{{user}}: "What is Eldoria?"\n{{char}}: "Here."',
		lore: { position: 'before', kept: { use_regex: true, extensions: { display_index: 0, automation_id: '' } } },
	}])
	expect(report).toEqual([])
})

const everything = {
	keys: ['vell', '/vel+/i', 'x'.repeat(51)],
	secondary_keys: ['rain'],
	comment: 'Vell / town',
	content: 'The town of Vell.',
	constant: true,
	selective: true,
	insertion_order: 7,
	priority: 3,
	enabled: false,
	case_sensitive: true,
	extensions: {
		position: 4, depth: 2, role: 2, selectiveLogic: 3, probability: 40, useProbability: true, group: 'towns', group_override: true,
		group_weight: 30, use_group_scoring: true, prevent_recursion: true, exclude_recursion: true, delay_until_recursion: true,
		scan_depth: 6, match_whole_words: false, vectorized: true, sticky: 2, cooldown: 3, delay: 4,
		match_character_description: true, match_persona_description: true, automation_id: 'run-me', ignore_budget: true,
	},
}

test('every option converts: honoured ones into the note\'s options, the others kept and named', () => {
	const { notes, lorebook, report } = cardBookToLorebook({ name: 'Towns', scan_depth: 3, token_budget: 500, recursive_scanning: true, extensions: { custom: 1 }, entries: [everything] })
	expect(lorebook).toEqual({ on: true, scanDepth: 3, maxChars: 2000, recursive: true, kept: { extensions: { custom: 1 } } })
	expect(notes[0]).toEqual({
		name: 'Vell - town',
		tags: ['vell', '/vel+/i'],
		content: 'The town of Vell.',
		lore: {
			enabled: false, constant: true, secondaryKeys: ['rain'], logic: 'andAll', caseSensitive: true, wholeWords: false, scanDepth: 6,
			order: 7, priority: 3, position: 'depth', depth: 2, role: 'assistant', preventRecursion: true, excludeRecursion: true,
			delayUntilRecursion: true, group: 'towns', groupOverride: true, groupWeight: 30, groupScoring: true, probability: 40,
			sticky: 2, cooldown: 3, delay: 4, fuzzy: true, scanInstructions: true, scanUserCharacter: true,
			kept: { extensions: { automation_id: 'run-me', ignore_budget: true } },
		},
	})
	expect(report).toEqual([
		'Its token budget of 500 became 2,000 characters.',
		'1 lorebook keyword was left out: over 50 characters, repeated, or past the 20th of an entry.',
		'1 lorebook keyword is a regular expression: matched as plain text here.',
		'1 lorebook entry matched by meaning (vectorized) is also matched by the words of its text.',
		'1 lorebook entry also searches the Character\'s instructions, which hold its description, personality and scenario.',
		'1 lorebook entry also searches the user\'s Character, in place of the persona.',
		'Lorebook options kept for export but not used here: automation_id, ignore_budget.',
	])
})

test('author\'s note entries go 4 messages up as system; outlet ones go with auto-fetch, their position kept', () => {
	const entry = (position: number) => ({ keys: ['k'], content: 'c', extensions: { position } })
	const { notes, report } = cardBookToLorebook({ entries: [entry(2), entry(3), entry(7), entry(5), { keys: ['k'], content: 'c', position: 'after_char' }] })
	expect(notes.map(note => note.lore)).toEqual([
		{ position: 'depth', depth: 4, role: 'system' },
		{ position: 'depth', depth: 4, role: 'system' },
		{ kept: { extensions: { position: 7 } } },
		{ position: 'after' },
		{ position: 'after' },
	])
	expect(report).toContain('2 lorebook entries placed at the author\'s note go 4 messages up, as system: there is no author\'s note here.')
	expect(report).toContain('1 lorebook entry with an outlet position goes with auto-fetched files: there are no outlets here.')
})

test('names: the comment, else the name, else the first keyword, else a number; unique, without slashes', () => {
	const { notes } = cardBookToLorebook({ entries: [{ comment: 'Inn', keys: [] }, { comment: 'inn', keys: [] }, { name: 'Named', keys: ['k'] }, { keys: ['first', 'second'] }, { keys: [] }, { comment: '..', keys: [] }] })
	expect(notes.map(note => note.name)).toEqual(['Inn', 'inn (2)', 'Named', 'first', 'Entry 5', 'Entry 6'])
})

test('notes back to a card book and in again: the same notes and options', () => {
	const first = cardBookToLorebook({ name: 'Towns', description: 'Places', scan_depth: 3, token_budget: 500, recursive_scanning: true, extensions: { custom: 1 }, entries: [seraphina, everything, { keys: ['k'], content: 'c', extensions: { position: 7 } }, { keys: ['k2'], content: 'c', selective: false, secondary_keys: ['ignored'] }] })
	const book = lorebookToCardBook({ name: 'Towns', description: 'Places', lorebook: first.lorebook }, first.notes)
	expect(book).toMatchObject({ name: 'Towns', description: 'Places', scan_depth: 3, token_budget: 500, recursive_scanning: true, extensions: { custom: 1 } })
	expect(book.entries[0]).toMatchObject({ keys: seraphina.keys, comment: 'eldoria', position: 'before_char', use_regex: true, extensions: { position: 0, display_index: 0 } })
	const again = cardBookToLorebook(book)
	expect(again.notes).toEqual(first.notes)
	expect(again.lorebook).toEqual(first.lorebook)
})
