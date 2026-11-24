import Fuse from 'fuse.js'
// Relative, not `#shared`, so this module also loads in `bun test`.
import type { AutoFetchSettings } from '../../../shared/utils/chat'
import { searchWords } from './search'

/** A file or note that may be fetched. `chars` counts toward `maxChars` (images and PDFs count 0). */
export interface Candidate {
	id: string
	parentId: string | null
	kind: 'folder' | 'file' | 'note'
	name: string
	tags: string[]
	chars: number
}

/** A piece of scanned text. `age` 0 is the newest message; system text is the oldest. */
export interface Scanned {
	text: string
	age: number
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Where a tag first appears in a text, or -1: case-insensitive, and as a whole word when it is plain Latin letters and
 * digits. Also how a group chat finds a participant's name in a message.
 */
export function tagIndex(tag: string, text: string) {
	if (/^[a-z0-9]+$/i.test(tag)) return text.search(new RegExp(`(?<![a-z0-9])${escape(tag)}(?![a-z0-9])`, 'i'))
	return text.toLowerCase().indexOf(tag.toLowerCase())
}

/** Whether a tag appears in a text, by the rule of `tagIndex`. */
export const tagMatches = (tag: string, text: string) => tagIndex(tag, text) !== -1

/**
 * What auto-fetch searches: the last `scanMessages` messages of the scanned roles together (the newest has age 0)
 * and, with `system`, the lane's system prompt, which counts as the oldest. Summaries are not searched.
 */
export function scannedTexts(
	thread: { role: string, parts: { type: string, text?: string }[] }[],
	systemPrompt: string | null,
	settings: Pick<AutoFetchSettings, 'scan' | 'scanMessages'>,
): Scanned[] {
	const roles = settings.scan.filter(role => role !== 'system')
	const messages = thread.filter(message => roles.some(role => role === message.role)).slice(-settings.scanMessages).reverse()
	const pieces = messages.map((message, age) => ({ text: message.parts.map(part => part.type === 'text' ? part.text ?? '' : '').join('\n'), age }))
	if (settings.scan.includes('system') && systemPrompt) pieces.push({ text: systemPrompt, age: pieces.length })
	return pieces
}

/**
 * The entries to fetch, best first. An entry counts when one of its tags appears in the scanned text, or (with
 * `fuzzy`) when the scanned words find it by name or tags (Fuse, forgiving typos) or by its text (`textMatches`, from
 * the full-text index). Ranked by the number of matching tags, then by how recent the newest matching text is, then
 * by the fuzzy score; limited to `folders`, cut to `maxEntries` and `maxChars` (an entry that does not fit is
 * skipped, a smaller one after it may still fit). `exclude`: entries the context already holds, such as "@"
 * references.
 */
export function rankEntries(input: {
	entries: Candidate[]
	scanned: Scanned[]
	settings: Pick<AutoFetchSettings, 'maxEntries' | 'maxChars' | 'fuzzy' | 'folders'>
	/** Fuzzy search only: entries whose text matched a scanned piece of age `age` in the full-text index. */
	textMatches?: { id: string, age: number, score: number }[]
	exclude?: string[]
}) {
	const { entries, scanned, settings } = input
	const byId: Record<string, Candidate> = Object.fromEntries(entries.map(entry => [entry.id, entry]))
	const scope: Record<string, true> = Object.fromEntries(settings.folders.map(id => [id, true]))
	const inScope = (entry: Candidate) => {
		if (!settings.folders.length) return true
		for (let id = entry.parentId, step = 0; id && step <= entries.length; id = byId[id]?.parentId ?? null, step++) {
			if (scope[id]) return true
		}
		return false
	}
	const excluded: Record<string, true> = Object.fromEntries((input.exclude ?? []).map(id => [id, true]))
	const candidates = entries.filter(entry => entry.kind !== 'folder' && !excluded[entry.id] && inScope(entry))

	const hits: Record<string, { entry: Candidate, tags: string[], age: number, score: number }> = {}
	const hit = (entry: Candidate, age: number) => hits[entry.id] ??= { entry, tags: [], age, score: 0 }

	for (const entry of candidates) {
		for (const tag of entry.tags) {
			const matching = scanned.filter(piece => tagMatches(tag, piece.text))
			if (!matching.length) continue
			const found = hit(entry, Math.min(...matching.map(piece => piece.age)))
			found.tags.push(tag)
			found.age = Math.min(found.age, ...matching.map(piece => piece.age))
		}
	}

	if (settings.fuzzy && candidates.length) {
		const fuse = new Fuse(candidates.map(entry => ({ entry, name: entry.name, tags: entry.tags })), {
			keys: [{ name: 'name', weight: 2 }, { name: 'tags', weight: 3 }],
			includeScore: true,
			ignoreLocation: true,
			ignoreFieldNorm: true,
			threshold: 0.2,
		})
		for (const piece of scanned) {
			for (const word of searchWords(piece.text)) {
				for (const result of fuse.search(word)) {
					const found = hit(result.item.entry, piece.age)
					found.age = Math.min(found.age, piece.age)
					found.score += 1 - (result.score ?? 1)
				}
			}
		}
		const byCandidate: Record<string, Candidate> = Object.fromEntries(candidates.map(entry => [entry.id, entry]))
		for (const match of input.textMatches ?? []) {
			const entry = byCandidate[match.id]
			if (!entry) continue
			const found = hit(entry, match.age)
			found.age = Math.min(found.age, match.age)
			found.score += match.score
		}
	}

	const ranked = Object.values(hits).sort((a, b) => b.tags.length - a.tags.length || a.age - b.age || b.score - a.score)
	const picked: typeof ranked = []
	let chars = 0
	for (const entry of ranked) {
		if (picked.length >= settings.maxEntries) break
		if (chars + entry.entry.chars > settings.maxChars) continue
		chars += entry.entry.chars
		picked.push(entry)
	}
	return picked.map(({ entry, tags }) => ({ ...entry, matchedTags: tags }))
}
