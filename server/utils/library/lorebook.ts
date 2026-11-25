import { and, eq, inArray } from 'drizzle-orm'
// Relative, not `hub:db` or `#shared`, so this module also loads in `bun test`.
import * as tables from '../../db/schema'
import type { Db } from '../core/settings'
import type { ContextBlock } from '../../../shared/utils/chat'
import type { Lore, Lorebook } from '../../../shared/utils/lorebook'
import { tagMatches } from './matcher'

/** A lorebook note as the matcher reads it: its keywords are the note's tags. */
export interface LoreNote {
	id: string
	libraryId: string
	name: string
	keys: string[]
	text: string
	lore: Lore
}

/** A library with its lorebook switch on. */
export interface LoreBook extends Omit<Lorebook, 'on' | 'kept'> {
	id: string
}

/** A note sent with an earlier answer of the lane: `at` is that answer's place in the thread; `sticky` when it stayed. */
export interface LoreSent {
	entryId: string
	at: number
	sticky: boolean
}

/** Sent notes are searched for more keywords at most this many times. */
const RECURSION_PASSES = 3
const DEFAULT_ORDER = 100

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Whether a keyword appears in a text. Unset options follow auto-fetch's rule (`tagMatches`): any case, whole words
 * for plain Latin. `wholeWords` true holds a keyword to letters and digits around it in any script; false finds it
 * anywhere. Regular-expression keywords (`/…/`) are matched as plain text: a card's pattern is not run here.
 */
export function keyMatches(key: string, text: string, lore: Pick<Lore, 'caseSensitive' | 'wholeWords'>) {
	if ((lore.caseSensitive ?? null) === null && (lore.wholeWords ?? null) === null) return tagMatches(key, text)
	const whole = lore.wholeWords ?? /^[a-z0-9]+$/i.test(key)
	const pattern = whole ? `(?<![\\p{L}\\p{N}])${escape(key)}(?![\\p{L}\\p{N}])` : escape(key)
	return new RegExp(pattern, lore.caseSensitive ? 'u' : 'iu').test(text)
}

/** How many keywords match (`0` when it does not): any primary keyword, then the "also needs" ones by their logic. */
function matchScore(note: LoreNote, text: string) {
	const primary = note.keys.filter(key => keyMatches(key, text, note.lore)).length
	if (!primary) return 0
	const secondary = note.lore.secondaryKeys ?? []
	if (!secondary.length) return primary
	const found = secondary.filter(key => keyMatches(key, text, note.lore)).length
	const logic = note.lore.logic ?? 'andAny'
	const passes = logic === 'andAny' ? found > 0 : logic === 'andAll' ? found === secondary.length : logic === 'notAny' ? found === 0 : found < secondary.length
	return passes ? primary + (logic.startsWith('and') ? found : 0) : 0
}

const groupsOf = (note: LoreNote) => (note.lore.group ?? '').split(',').map(group => group.trim()).filter(Boolean)

/**
 * The lorebook notes one answer is sent, in the order they are sent (plan section 2b).
 *
 * - **Timed effects**, from `sent` (what the lane's earlier answers were sent): a note `sticky` N stays while the new
 *   answer is at most N messages after the one it was matched for, without matching; `cooldown` N then keeps it out
 *   for N more; `delay` N keeps it out while the thread has fewer than N messages.
 * - **Matching**: `constant` notes always; others when a keyword appears in the latest `scanDepth` messages (the
 *   note's, else its book's, else `defaults`), the Character's instructions (`scanInstructions`) or the user's
 *   Character (`scanUserCharacter`), and the "also needs" keywords agree; `fuzzy` ones also when the full-text index
 *   found them (`fuzzyHits`). A matching note is sent with its `probability`.
 * - **Recursion**, for books with `recursive`: the sent notes' texts (but `preventRecursion` ones') are searched
 *   again, at most 3 passes. `excludeRecursion` notes are not found that way; `delayUntilRecursion` notes only that way.
 * - **Groups**: of the notes sharing a group, one is sent: one kept from before, else a sticky one, else one with
 *   `groupOverride` (highest order), else (with `groupScoring`) the most matched keywords, else by `groupWeight`.
 * - **Budget**, per book (`maxChars`, else `defaults`): constant and sticky notes first, then by priority (else
 *   order), highest first; a note that does not fit is left out, a smaller one after it may still fit.
 * - **Order**: by `order`, lowest first, then by name.
 */
export function matchLorebook(input: {
	books: LoreBook[]
	notes: LoreNote[]
	/** The conversation's texts, oldest first: the user's messages and the answers. */
	messages: string[]
	instructions?: string | null
	userCharacter?: string | null
	defaults: { scanDepth: number, maxChars: number }
	/** Messages in the thread before the new answer. */
	length: number
	sent?: LoreSent[]
	fuzzyHits?: Record<string, true>
	random?: () => number
}) {
	const random = input.random ?? Math.random
	const books: Record<string, LoreBook> = Object.fromEntries(input.books.map(book => [book.id, book]))
	const notes = input.notes.filter(note => books[note.libraryId] && note.lore.enabled !== false)

	// Timed effects: the last time each note was matched (not kept by sticky).
	const lastMatched: Record<string, number> = {}
	for (const sent of input.sent ?? []) {
		if (!sent.sticky) lastMatched[sent.entryId] = Math.max(lastMatched[sent.entryId] ?? -Infinity, sent.at)
	}
	const timing = (note: LoreNote): 'sticky' | 'blocked' | 'free' => {
		const { sticky = 0, cooldown = 0, delay = 0 } = note.lore
		if (input.length < delay) return 'blocked'
		const at = lastMatched[note.id]
		if (at === undefined) return 'free'
		const since = input.length - at
		if (sticky > 0 && since <= sticky) return 'sticky'
		return cooldown > 0 && since <= sticky + cooldown ? 'blocked' : 'free'
	}

	const recent = (depth: number) => input.messages.slice(Math.max(0, input.messages.length - depth)).join('\n')
	const scanned = (note: LoreNote) => [
		recent(note.lore.scanDepth ?? books[note.libraryId]!.scanDepth ?? input.defaults.scanDepth),
		note.lore.scanInstructions ? input.instructions ?? '' : '',
		note.lore.scanUserCharacter ? input.userCharacter ?? '' : '',
	].join('\n')

	interface Sent { note: LoreNote, sticky: boolean, score: number, pass: number }
	const chosen = new Map<string, Sent>()
	// Notes that lost their chance or their group this turn: not tried again by recursion.
	const out: Record<string, true> = {}

	/** Keeps one note per group: earlier passes first, then sticky, override, score, weight. */
	const settleGroups = (pass: number) => {
		const byGroup: Record<string, Sent[]> = {}
		for (const sent of chosen.values()) for (const group of groupsOf(sent.note)) (byGroup[group] ??= []).push(sent)
		for (const members of Object.values(byGroup)) {
			const left = members.filter(member => chosen.has(member.note.id))
			if (left.length < 2) continue
			const earlier = left.filter(member => member.pass < pass)
			const sticky = left.filter(member => member.sticky)
			const overrides = left.filter(member => member.note.lore.groupOverride)
			let winner = earlier[0] ?? sticky[0]
				?? overrides.sort((a, b) => (b.note.lore.order ?? DEFAULT_ORDER) - (a.note.lore.order ?? DEFAULT_ORDER))[0]
			if (!winner) {
				let pool = left
				if (left.some(member => member.note.lore.groupScoring)) {
					const best = Math.max(...left.map(member => member.score))
					pool = left.filter(member => member.score === best)
				}
				const total = pool.reduce((sum, member) => sum + (member.note.lore.groupWeight ?? 100), 0)
				let roll = random() * total
				winner = pool.find(member => (roll -= member.note.lore.groupWeight ?? 100) < 0) ?? pool.at(-1)!
			}
			for (const member of left) {
				if (member === winner) continue
				chosen.delete(member.note.id)
				out[member.note.id] = true
			}
		}
	}

	const tryNote = (note: LoreNote, score: number, pass: number) => {
		if (random() * 100 >= (note.lore.probability ?? 100)) {
			out[note.id] = true
			return
		}
		chosen.set(note.id, { note, sticky: false, score, pass })
	}

	for (const note of notes) {
		const timed = timing(note)
		if (timed === 'blocked') continue
		if (timed === 'sticky') {
			chosen.set(note.id, { note, sticky: true, score: 0, pass: 0 })
			continue
		}
		if (note.lore.delayUntilRecursion) continue
		if (note.lore.constant) {
			tryNote(note, 0, 0)
			continue
		}
		const score = matchScore(note, scanned(note)) + (note.lore.fuzzy && input.fuzzyHits?.[note.id] ? 1 : 0)
		if (score) tryNote(note, score, 0)
	}
	settleGroups(0)

	for (let pass = 1; pass <= RECURSION_PASSES; pass++) {
		const buffer = [...chosen.values()].filter(sent => !sent.note.lore.preventRecursion).map(sent => sent.note.text).join('\n')
		if (!buffer) break
		let found = false
		for (const note of notes) {
			if (chosen.has(note.id) || out[note.id] || !books[note.libraryId]!.recursive || note.lore.excludeRecursion || timing(note) !== 'free') continue
			const score = matchScore(note, buffer)
			if (!score) continue
			tryNote(note, score, pass)
			found = true
		}
		if (!found) break
		settleGroups(pass)
	}

	// The budget, per book.
	const fits: Sent[] = []
	for (const book of input.books) {
		const own = [...chosen.values()].filter(sent => sent.note.libraryId === book.id)
		const first = (sent: Sent) => sent.sticky || sent.note.lore.constant ? 0 : 1
		const rank = (sent: Sent) => sent.note.lore.priority ?? sent.note.lore.order ?? DEFAULT_ORDER
		own.sort((a, b) => first(a) - first(b) || rank(b) - rank(a))
		let left = book.maxChars ?? input.defaults.maxChars
		for (const sent of own) {
			if (sent.note.text.length > left) continue
			left -= sent.note.text.length
			fits.push(sent)
		}
	}
	return fits
		.sort((a, b) => (a.note.lore.order ?? DEFAULT_ORDER) - (b.note.lore.order ?? DEFAULT_ORDER) || a.note.name.localeCompare(b.note.name))
		.map(({ note, sticky }) => ({ note, sticky }))
}

/** The notes of the given lorebook libraries, text included. */
export async function lorebookNotes(db: Db, libraryIds: string[]): Promise<LoreNote[]> {
	if (!libraryIds.length) return []
	const rows = await db.select({
		id: tables.libraryEntry.id,
		libraryId: tables.libraryEntry.libraryId,
		name: tables.libraryEntry.name,
		keys: tables.libraryEntry.tags,
		text: tables.libraryEntry.content,
		lore: tables.libraryEntry.lore,
	}).from(tables.libraryEntry)
		.where(and(inArray(tables.libraryEntry.libraryId, libraryIds), eq(tables.libraryEntry.kind, 'note')))
	return rows.map(row => ({ ...row, text: row.text ?? '', lore: row.lore ?? {} }))
}

/**
 * What the lane's earlier answers were sent from its lorebooks, from their turn traces: `answers` are the lane's
 * answers in the thread with their place in it. Only answers within the longest sticky and cooldown are read.
 */
export async function lorebookHistory(db: Db, answers: { id: string, at: number }[], notes: LoreNote[], length: number): Promise<LoreSent[]> {
	const reach = Math.max(0, ...notes.map(note => (note.lore.sticky ?? 0) + (note.lore.cooldown ?? 0)))
	const wanted = reach ? answers.filter(answer => length - answer.at <= reach) : []
	if (!wanted.length) return []
	const at: Record<string, number> = Object.fromEntries(wanted.map(answer => [answer.id, answer.at]))
	const traces = await db.select({ messageId: tables.turnTrace.messageId, blocks: tables.turnTrace.blocks }).from(tables.turnTrace)
		.where(inArray(tables.turnTrace.messageId, wanted.map(answer => answer.id)))
	return traces.flatMap(trace => (trace.blocks as ContextBlock[]).flatMap(block =>
		block.kind === 'lore' && block.entryId ? [{ entryId: block.entryId, at: at[trace.messageId]!, sticky: !!block.sticky }] : []))
}
