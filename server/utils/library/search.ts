import { and, desc, inArray, sql } from 'drizzle-orm'
// Relative, not `hub:db`, so this module also loads in `bun test`.
import * as tables from '../../db/schema'
import type { Db } from '../core/settings'

const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
/** Full-text search reads at most this much of each note and text file. */
const SEARCH_TEXT_CAP = 200_000

// ponytail: a tiny English stop list for queries; Postgres's `english` configuration drops the rest.
const STOP: Record<string, true> = Object.fromEntries('the a an and or not of to in on for with is are was were be do does did what when how why who which this that it we i you they my your our want like much'.split(' ').map(word => [word, true]))

/**
 * Text as words separated by spaces, for `to_tsvector`. Chinese has no spaces between words, so the words are split
 * here with `Intl.Segmenter`; Postgres's parsers would take a run of Chinese characters as one word.
 */
export function searchableText(...texts: string[]) {
	const words: string[] = []
	for (const text of texts) {
		for (const { segment, isWordLike } of segmenter.segment(text.slice(0, SEARCH_TEXT_CAP))) {
			if (isWordLike) words.push(segment)
		}
	}
	return words.join(' ')
}

/** The words of a text worth searching (spike D): no stop words, Latin words of 3+ letters, Chinese words of 2+ characters. */
export function searchWords(text: string) {
	const found: Record<string, true> = {}
	for (const { segment, isWordLike } of segmenter.segment(text.toLowerCase())) {
		if (!isWordLike || STOP[segment]) continue
		if (/\p{Script=Han}/u.test(segment) ? segment.length >= 2 : segment.length >= 3) found[segment] = true
	}
	return Object.keys(found)
}

/**
 * Notes and text files of the libraries whose text has any of the words of `text`, best first: more and rarer matches
 * rank higher (`ts_rank`). Each comes with a short excerpt around the matches. Entries not yet filled are not
 * found; `fillSearchText` fills them first.
 */
export async function searchEntryTexts(db: Db, libraryIds: string[], text: string, limit = 10) {
	const words = searchWords(text).slice(0, 30)
	if (!words.length || !libraryIds.length) return []
	const query = sql`websearch_to_tsquery('english', ${words.join(' or ')})`
	return await db.select({
		id: tables.libraryEntry.id,
		rank: sql<number>`ts_rank(${tables.libraryEntry.searchVector}, ${query})`.mapWith(Number),
		excerpt: sql<string>`ts_headline('english', ${tables.libraryEntry.searchText}, ${query}, 'MaxWords=24, MinWords=8, MaxFragments=2')`,
	}).from(tables.libraryEntry)
		.where(and(inArray(tables.libraryEntry.libraryId, libraryIds), sql`${tables.libraryEntry.searchVector} @@ ${query}`))
		.orderBy(desc(sql`ts_rank(${tables.libraryEntry.searchVector}, ${query})`))
		.limit(limit)
}
