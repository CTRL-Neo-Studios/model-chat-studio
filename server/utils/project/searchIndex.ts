import { blob } from 'hub:blob'
import { schema } from 'hub:db'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { FILE_UPLOAD } from '#shared/utils/file'
import type { Db } from '#server/utils/core/settings'
import { searchableText } from './search'

/**
 * Fills the searchable text of a project's notes and text files that have none yet: new ones, changed ones, and
 * ones from before full-text search. Text files are read from storage once; images and PDFs are not searched.
 */
export async function fillSearchText(db: Db, projectId: string) {
	const missing = await db.select({
		id: schema.projectEntry.id,
		kind: schema.projectEntry.kind,
		name: schema.projectEntry.name,
		content: schema.projectEntry.content,
		blobPath: schema.file.blobPath,
	}).from(schema.projectEntry)
		.leftJoin(schema.file, eq(schema.file.id, schema.projectEntry.fileId))
		.where(and(
			eq(schema.projectEntry.projectId, projectId),
			isNull(schema.projectEntry.searchText),
			or(eq(schema.projectEntry.kind, 'note'), inArray(schema.file.mediaType, [...FILE_UPLOAD.textTypes])),
		))
	for (const entry of missing) {
		const stored = entry.kind === 'file' && entry.blobPath ? await blob.get(entry.blobPath) : null
		const text = entry.kind === 'note' ? entry.content ?? '' : stored ? await stored.text() : ''
		await db.update(schema.projectEntry).set({ searchText: searchableText(entry.name, text) }).where(eq(schema.projectEntry.id, entry.id))
	}
}
