import { describe, expect, test } from 'bun:test'
import { type Candidate, rankEntries, scannedTexts, tagMatches } from '../server/utils/library/matcher'

const settings = { maxEntries: 5, maxChars: 60_000, fuzzy: false, folders: [] as string[] }
const entry = (id: string, tags: string[], fields: Partial<Candidate> = {}): Candidate => ({ id, parentId: null, kind: 'note', name: `${id}.md`, tags, chars: 100, ...fields })
const ids = (list: { id: string }[]) => list.map(item => item.id)

describe('tags', () => {
	test('a Latin tag matches as a whole word, in any case; other tags match anywhere', () => {
		expect(tagMatches('cat', 'The CAT sat')).toBe(true)
		expect(tagMatches('cat', 'cat-food and cat.')).toBe(true)
		expect(tagMatches('cat', 'a category')).toBe(false)
		expect(tagMatches('q3', 'plans for Q3?')).toBe(true)
		expect(tagMatches('q3', 'q34 numbers')).toBe(false)
		expect(tagMatches('c++', 'I write C++ daily')).toBe(true)
		expect(tagMatches('预算', '第三季度的预算是多少')).toBe(true)
	})
})

describe('ranking and caps', () => {
	const entries = [
		entry('one-tag-new', ['launch']),
		entry('two-tags-old', ['budget', 'q3']),
		entry('one-tag-old', ['budget']),
		entry('no-match', ['weather']),
		entry('folder', ['launch'], { kind: 'folder' }),
	]
	const scanned = [{ text: 'When is the launch?', age: 0 }, { text: 'The Q3 budget is fixed.', age: 1 }]

	test('more matching tags first, then the more recent match; folders are never fetched', () => {
		expect(ids(rankEntries({ entries, scanned, settings }))).toEqual(['two-tags-old', 'one-tag-new', 'one-tag-old'])
	})

	test('cut to the most entries, and to the most characters, skipping what does not fit', () => {
		expect(ids(rankEntries({ entries, scanned, settings: { ...settings, maxEntries: 2 } }))).toEqual(['two-tags-old', 'one-tag-new'])
		const sized = entries.map(item => item.id === 'one-tag-new' ? { ...item, chars: 500 } : item)
		expect(ids(rankEntries({ entries: sized, scanned, settings: { ...settings, maxChars: 300 } }))).toEqual(['two-tags-old', 'one-tag-old'])
	})

	test('limited to the chosen folders, including folders inside them; excluded entries are left out', () => {
		const tree = [
			entry('docs', [], { kind: 'folder' }),
			entry('deep', [], { kind: 'folder', parentId: 'docs' }),
			entry('inside', ['launch'], { parentId: 'deep' }),
			entry('outside', ['launch']),
		]
		expect(ids(rankEntries({ entries: tree, scanned, settings: { ...settings, folders: ['docs'] } }))).toEqual(['inside'])
		expect(ids(rankEntries({ entries: tree, scanned, settings, exclude: ['inside'] }))).toEqual(['outside'])
	})

	test('fuzzy also finds entries by name (forgiving typos) and by text matches from the index, after tag matches', () => {
		const withText = [entry('runbook', [], { name: 'kubernetes-deploy.md' }), entry('tagged', ['launch']), entry('notes', [])]
		const words = [{ text: 'launch steps for kubernets', age: 0 }, { text: 'older', age: 1 }]
		const textMatches = [{ id: 'notes', age: 1, score: 0.5 }, { id: 'unknown', age: 0, score: 1 }]
		expect(ids(rankEntries({ entries: withText, scanned: words, settings, textMatches }))).toEqual(['tagged'])
		expect(ids(rankEntries({ entries: withText, scanned: words, settings: { ...settings, fuzzy: true }, textMatches }))).toEqual(['tagged', 'runbook', 'notes'])
	})
})

describe('what is scanned', () => {
	const thread = [
		{ role: 'user', parts: [{ type: 'text', text: 'u1' }] },
		{ role: 'assistant', parts: [{ type: 'text', text: 'a1' }] },
		{ role: 'system', parts: [{ type: 'text', text: 'summary' }] },
		{ role: 'user', parts: [{ type: 'text', text: 'u2' }] },
		{ role: 'assistant', parts: [{ type: 'text', text: 'a2' }] },
		{ role: 'user', parts: [{ type: 'text', text: 'u3' }] },
	]
	const texts = (scan: ('user' | 'assistant' | 'system')[], scanMessages = 5) => scannedTexts(thread, 'sys prompt', { scan, scanMessages }).map(piece => `${piece.text}@${piece.age}`)

	test('user messages only by default; the last N of the chosen roles together, newest first', () => {
		expect(texts(['user'])).toEqual(['u3@0', 'u2@1', 'u1@2'])
		expect(texts(['user', 'assistant'], 3)).toEqual(['u3@0', 'a2@1', 'u2@2'])
		expect(texts(['assistant'])).toEqual(['a2@0', 'a1@1'])
	})

	test('system adds the lane\'s system prompt as the oldest text; summaries are not scanned', () => {
		expect(texts(['user', 'system'], 1)).toEqual(['u3@0', 'sys prompt@1'])
		expect(texts(['system'])).toEqual(['sys prompt@0'])
	})
})
