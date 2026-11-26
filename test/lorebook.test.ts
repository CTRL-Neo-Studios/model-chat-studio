import { describe, expect, test } from 'bun:test'
import { keyMatches, type LoreBook, type LoreNote, type LoreSent, matchLorebook } from '../server/utils/library/lorebook'
import type { Lore } from '../shared/utils/lorebook'

const note = (id: string, keys: string[], lore: Lore = {}, fields: Partial<LoreNote> = {}): LoreNote =>
	({ id, libraryId: 'book', name: id, keys, text: `${id} text`, lore, ...fields })
const run = (notes: LoreNote[], messages: string[], extra: Partial<Parameters<typeof matchLorebook>[0]> & { book?: Partial<LoreBook> } = {}) => {
	const { book, ...rest } = extra
	return matchLorebook({ books: [{ id: 'book', ...book }], notes, messages, defaults: { scanDepth: 5, maxChars: 60_000 }, length: messages.length, ...rest })
}
const ids = (sent: { note: LoreNote }[]) => sent.map(item => item.note.id)

describe('keywords', () => {
	test('by default as auto-fetch: any case, whole words for plain Latin', () => {
		expect(keyMatches('dragon', 'A DRAGON flies', {})).toBe(true)
		expect(keyMatches('dragon', 'dragonfly', {})).toBe(false)
		expect(keyMatches('龙', '一条龙', {})).toBe(true)
	})

	test('case-sensitive and whole-word options, per note', () => {
		expect(keyMatches('Mara', 'mara said', { caseSensitive: true })).toBe(false)
		expect(keyMatches('Mara', 'Mara said', { caseSensitive: true })).toBe(true)
		expect(keyMatches('dragon', 'dragonfly', { wholeWords: false })).toBe(true)
		expect(keyMatches('café', 'cafés', { wholeWords: true })).toBe(false)
		expect(keyMatches('café', 'the café!', { wholeWords: true })).toBe(true)
	})

	test('a regular-expression keyword is matched as plain text, never run', () => {
		expect(keyMatches('/drag(on)?/i', 'a dragon', {})).toBe(false)
		expect(keyMatches('/drag(on)?/i', 'they wrote /drag(on)?/i here', {})).toBe(true)
	})

	test('"also needs" keywords by their logic', () => {
		const with2 = (logic: Lore['logic']) => note('n', ['inn'], { secondaryKeys: ['rain', 'night'], logic })
		const sentFor = (logic: Lore['logic'], message: string) => ids(run([with2(logic)], [message]))
		expect(sentFor('andAny', 'the inn at night')).toEqual(['n'])
		expect(sentFor('andAny', 'the inn')).toEqual([])
		expect(sentFor('andAll', 'the inn at night')).toEqual([])
		expect(sentFor('andAll', 'the inn at night in the rain')).toEqual(['n'])
		expect(sentFor('notAny', 'the inn at night')).toEqual([])
		expect(sentFor('notAny', 'the inn')).toEqual(['n'])
		expect(sentFor('notAll', 'the inn at night')).toEqual(['n'])
		expect(sentFor('notAll', 'the inn at night in the rain')).toEqual([])
	})
})

describe('what is scanned and sent', () => {
	test('a disabled note never; a constant one always; answers are scanned as well as the user\'s messages', () => {
		const notes = [note('off', ['inn'], { enabled: false }), note('always', [], { constant: true }), note('answer', ['harbour'])]
		expect(ids(run(notes, ['the inn', 'We reach the harbour.']))).toEqual(['always', 'answer'])
	})

	test('scan depth: the note\'s, else its book\'s, else the chat\'s', () => {
		const messages = ['the inn', 'later', 'now']
		expect(ids(run([note('n', ['inn'])], messages))).toEqual(['n'])
		expect(ids(run([note('n', ['inn'])], messages, { book: { scanDepth: 2 } }))).toEqual([])
		expect(ids(run([note('n', ['inn'], { scanDepth: 3 })], messages, { book: { scanDepth: 2 } }))).toEqual(['n'])
		expect(ids(run([note('n', ['inn'])], messages, { defaults: { scanDepth: 1, maxChars: 60_000 } }))).toEqual([])
	})

	test('the Character\'s instructions and the user\'s Character, when the note asks', () => {
		const notes = [note('char', ['guide'], { scanInstructions: true }), note('user', ['knight'], { scanUserCharacter: true }), note('neither', ['guide'])]
		expect(ids(run(notes, ['hello'], { instructions: 'You are a guide.', userCharacter: 'The user is a knight.' }))).toEqual(['char', 'user'])
	})

	test('chance: a matching note is sent with its probability', () => {
		const notes = [note('likely', ['inn'], { probability: 60 }), note('unlikely', ['inn'], { probability: 40 })]
		expect(ids(run(notes, ['the inn'], { random: () => 0.5 }))).toEqual(['likely'])
	})

	test('full-text hits find a fuzzy note without its keywords, and only a fuzzy one', () => {
		const notes = [note('fuzzy', ['zzz'], { fuzzy: true }), note('plain', ['zzz'])]
		expect(ids(run(notes, ['hello'], { fuzzyHits: { fuzzy: true, plain: true } }))).toEqual(['fuzzy'])
	})

	test('sent by order, lowest first, then by name', () => {
		const notes = [note('b', ['inn'], { order: 5 }), note('a', ['inn'], { order: 5 }), note('c', ['inn'], { order: 1 })]
		expect(ids(run(notes, ['the inn']))).toEqual(['c', 'a', 'b'])
	})
})

describe('recursion', () => {
	const naming = note('tower', ['tower'], {}, { text: 'The tower stands over Vell.' })
	const town = note('vell', ['vell'])

	test('a sent note\'s text is searched for more keywords, when the book recurses', () => {
		expect(ids(run([naming, town], ['the tower'], { book: { recursive: true } }))).toEqual(['tower', 'vell'])
		expect(ids(run([naming, town], ['the tower']))).toEqual(['tower'])
	})

	test('prevent recursion on the naming note; exclude recursion on the named one', () => {
		expect(ids(run([{ ...naming, lore: { preventRecursion: true } }, town], ['the tower'], { book: { recursive: true } }))).toEqual(['tower'])
		expect(ids(run([naming, { ...town, lore: { excludeRecursion: true } }], ['the tower'], { book: { recursive: true } }))).toEqual(['tower'])
	})

	test('recursion into a delayed entry: one that waits for recursion is not found by the conversation, only by a note', () => {
		const delayed = { ...town, lore: { delayUntilRecursion: true } }
		expect(ids(run([delayed], ['in vell'], { book: { recursive: true } }))).toEqual([])
		expect(ids(run([naming, delayed], ['the tower'], { book: { recursive: true } }))).toEqual(['tower', 'vell'])
	})

	test('at most three passes', () => {
		const chain = ['a', 'b', 'c', 'd', 'e'].map((key, index, keys) => note(key, [`k${key}`], {}, { text: `then k${keys[index + 1] ?? 'none'}` }))
		expect(ids(run(chain, ['ka'], { book: { recursive: true } }))).toEqual(['a', 'b', 'c', 'd'])
	})
})

describe('groups', () => {
	test('one note per group: an override wins, highest order first', () => {
		const notes = [note('a', ['inn'], { group: 'g' }), note('b', ['inn'], { group: 'g', groupOverride: true, order: 1 }), note('c', ['inn'], { group: 'g', groupOverride: true, order: 2 })]
		expect(ids(run(notes, ['the inn']))).toEqual(['c'])
	})

	test('with scoring, the most matched keywords win; otherwise the weight decides', () => {
		const notes = [note('one', ['inn'], { group: 'g', groupScoring: true }), note('two', ['inn', 'rain'], { group: 'g' })]
		expect(ids(run(notes, ['the inn in the rain']))).toEqual(['two'])
		const weighted = [note('light', ['inn'], { group: 'g', groupWeight: 1 }), note('heavy', ['inn'], { group: 'g', groupWeight: 99 })]
		expect(ids(run(weighted, ['the inn'], { random: () => 0.5 }))).toEqual(['heavy'])
		expect(ids(run(weighted, ['the inn'], { random: () => 0.001 }))).toEqual(['light'])
	})

	test('a note in several groups competes in each; a sticky member keeps its group', () => {
		const notes = [note('a', ['inn'], { group: 'g, h', groupOverride: true }), note('b', ['inn'], { group: 'h' }), note('c', ['inn'], { group: 'i' })]
		expect(ids(run(notes, ['the inn']))).toEqual(['a', 'c'])
		const sticky = [note('kept', ['zzz'], { group: 'g', sticky: 3 }), note('new', ['inn'], { group: 'g', groupOverride: true })]
		expect(ids(run(sticky, ['x', 'y', 'the inn'], { sent: [{ entryId: 'kept', at: 1, sticky: false }] }))).toEqual(['kept'])
	})

	test('a group under the budget: the winner is chosen first, and a loser does not come back when it is too long', () => {
		const notes = [note('long', ['inn'], { group: 'g', groupOverride: true }, { text: 'x'.repeat(500) }), note('short', ['inn'], { group: 'g' })]
		expect(ids(run(notes, ['the inn'], { book: { maxChars: 100 } }))).toEqual([])
	})
})

describe('timed effects', () => {
	// The thread before the new answer: u0 a1 u2 a3 u4 …; the note was matched for the answer at place 1.
	const fired: LoreSent[] = [{ entryId: 'n', at: 1, sticky: false }]
	const thread = (length: number, last = 'nothing here') => [...Array.from({ length: length - 1 }, () => 'filler'), last]

	test('sticky: stays without matching for N messages after it was matched', () => {
		const sticky = note('n', ['inn'], { sticky: 2 })
		expect(run([sticky], thread(3), { sent: fired })).toEqual([{ note: sticky, sticky: true }])
		expect(ids(run([sticky], thread(5), { sent: fired }))).toEqual([])
		expect(ids(run([sticky], thread(5, 'the inn'), { sent: fired }))).toEqual(['n'])
	})

	test('cooldown: kept out for N messages after it was matched, even when its keywords appear', () => {
		const cooling = note('n', ['inn'], { cooldown: 2 })
		expect(ids(run([cooling], thread(3, 'the inn'), { sent: fired }))).toEqual([])
		expect(ids(run([cooling], thread(4, 'the inn'), { sent: fired }))).toEqual(['n'])
	})

	test('delay: not before the chat has N messages', () => {
		const delayed = note('n', ['inn'], { delay: 4 })
		expect(ids(run([delayed], thread(3, 'the inn')))).toEqual([])
		expect(ids(run([delayed], thread(4, 'the inn')))).toEqual(['n'])
	})

	test('sticky after cooldown: stays, then waits, then is matched again; its sticky sends do not restart the clock', () => {
		const both = note('n', ['inn'], { sticky: 2, cooldown: 2 })
		const history: LoreSent[] = [...fired, { entryId: 'n', at: 3, sticky: true }]
		expect(run([both], thread(3), { sent: fired })[0]?.sticky).toBe(true)
		expect(ids(run([both], thread(5, 'the inn'), { sent: history }))).toEqual([])
		expect(ids(run([both], thread(6, 'the inn'), { sent: history }))).toEqual(['n'])
	})
})

describe('budget', () => {
	test('per book: constant and sticky notes first, then by priority (else order), a note that does not fit skipped', () => {
		const notes = [
			note('low', ['inn'], { priority: 1 }, { text: 'x'.repeat(40) }),
			note('high', ['inn'], { priority: 9 }, { text: 'x'.repeat(40) }),
			note('constant', [], { constant: true, priority: 0 }, { text: 'x'.repeat(40) }),
			note('small', ['inn'], { priority: 0 }, { text: 'x'.repeat(10) }),
		]
		expect(ids(run(notes, ['the inn'], { book: { maxChars: 95 } }))).toEqual(['constant', 'high', 'small'])
	})

	test('each book has its own budget; without one, the chat\'s', () => {
		const notes = [note('a', ['inn'], {}, { text: 'x'.repeat(60) }), note('b', ['inn'], {}, { libraryId: 'other', text: 'x'.repeat(60) })]
		const books = [{ id: 'book', maxChars: 100 }, { id: 'other', maxChars: 100 }]
		expect(ids(run(notes, ['the inn'], { books }))).toEqual(['a', 'b'])
		expect(ids(run(notes, ['the inn'], { books: [{ id: 'book' }, { id: 'other' }], defaults: { scanDepth: 5, maxChars: 100 } }))).toEqual(['a', 'b'])
		expect(ids(run(notes, ['the inn'], { books: [{ id: 'book', maxChars: 50 }] }))).toEqual([])
	})
})
