import { createError, defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { libraryAbilities } from '#shared/abilities/libraryAbilities'
import { authorize } from '#server/utils/core/authorize'
import { assertEntryParent, entryColumns, entryNameSchema, findEntry, findLibrary, listEntries, noteContentSchema, tagsSchema, withUniqueName } from '#server/utils/library/libraries'
import { loreSchema } from '#shared/utils/lorebook'

const bodySchema = z.object({
	name: entryNameSchema,
	/** `null` moves the entry to the top level. */
	parentId: z.uuid().nullable(),
	tags: tagsSchema,
	/** Notes only. */
	content: noteContentSchema,
	/** Notes only: the lorebook options; the kept card fields are left as they are. */
	lore: loreSchema.omit({ kept: true }),
}).partial().strict()
	.refine(fields => Object.keys(fields).length > 0, 'Nothing to change')

/** Renames, moves, tags or edits an entry. A folder cannot move into itself or a folder inside it. */
export default defineEventHandler(async (event) => {
	const library = await findLibrary(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, libraryAbilities().editFiles, library)
	const fields = await readValidatedBody(event, bodySchema)
	const entries = await listEntries(db, library!.id)
	const entry = entries.find(entry => entry.id === getRouterParam(event, 'entryId', { decode: true }))
	if (!entry) throw createError({ status: 404, statusText: 'Entry not found' })
	if ((fields.content !== undefined || fields.lore !== undefined) && entry.kind !== 'note') throw createError({ status: 400, statusText: 'Only a note has text and lorebook options' })
	const kept = fields.lore && (await findEntry(db, library!.id, entry.id))?.lore?.kept
	const lore = fields.lore && { lore: { ...fields.lore, ...(kept && { kept }) } }
	if (fields.parentId !== undefined) assertEntryParent(entries, fields.parentId, entry.id)

	// A new name or text is searched once search fills it again.
	const searchText = fields.name !== undefined || fields.content !== undefined ? { searchText: null } : {}
	const [updated] = await withUniqueName(db.update(schema.libraryEntry).set({ ...fields, ...lore, ...searchText })
		.where(eq(schema.libraryEntry.id, entry.id))
		.returning(entryColumns))
	// A download is named after the entry.
	if (fields.name && entry.fileId) await db.update(schema.file).set({ fileName: fields.name }).where(eq(schema.file.id, entry.fileId))
	return updated!
})
