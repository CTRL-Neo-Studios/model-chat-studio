import { blob } from 'hub:blob'
import { schema } from 'hub:db'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { FILE_UPLOAD } from '#shared/utils/file'
import type { Db } from '#server/utils/core/settings'
import { searchableText } from './search'

/**
 * Fills the searchable text of a library's notes and text files that have none yet: new ones, changed ones, and
 * ones from before full-text search. Text files are read from storage once; images and PDFs are not searched.
 */
export async function fillSearchText(db: Db, libraryId: string) {
	const missing = await db.select({
		id: schema.libraryEntry.id,
		kind: schema.libraryEntry.kind,
		name: schema.libraryEntry.name,
		content: schema.libraryEntry.content,
		blobPath: schema.file.blobPath,
	}).from(schema.libraryEntry)
		.leftJoin(schema.file, eq(schema.file.id, schema.libraryEntry.fileId))
		.where(and(
			eq(schema.libraryEntry.libraryId, libraryId),
			isNull(schema.libraryEntry.searchText),
			or(eq(schema.libraryEntry.kind, 'note'), inArray(schema.file.mediaType, [...FILE_UPLOAD.textTypes])),
		))
	for (const entry of missing) {
		const stored = entry.kind === 'file' && entry.blobPath ? await blob.get(entry.blobPath) : null
		const text = entry.kind === 'note' ? entry.content ?? '' : stored ? await stored.text() : ''
		await db.update(schema.libraryEntry).set({ searchText: searchableText(entry.name, text) }).where(eq(schema.libraryEntry.id, entry.id))
	}
}
