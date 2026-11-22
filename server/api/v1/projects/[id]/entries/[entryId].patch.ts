import { createError, defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { projectAbilities } from '#shared/abilities/projectAbilities'
import { authorize } from '#server/utils/core/authorize'
import { assertEntryParent, entryNameSchema, findProject, listEntries, noteContentSchema, tagsSchema, withUniqueName } from '#server/utils/project/projects'

const bodySchema = z.object({
	name: entryNameSchema,
	/** `null` moves the entry to the top level. */
	parentId: z.uuid().nullable(),
	tags: tagsSchema,
	/** Notes only. */
	content: noteContentSchema,
}).partial().strict()
	.refine(fields => Object.keys(fields).length > 0, 'Nothing to change')

/** Renames, moves, tags or edits an entry. A folder cannot move into itself or a folder inside it. */
export default defineEventHandler(async (event) => {
	const project = await findProject(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, projectAbilities().editFiles, project)
	const fields = await readValidatedBody(event, bodySchema)
	const entries = await listEntries(db, project!.id)
	const entry = entries.find(entry => entry.id === getRouterParam(event, 'entryId', { decode: true }))
	if (!entry) throw createError({ status: 404, statusText: 'Entry not found' })
	if (fields.content !== undefined && entry.kind !== 'note') throw createError({ status: 400, statusText: 'Only a note has text to edit' })
	if (fields.parentId !== undefined) assertEntryParent(entries, fields.parentId, entry.id)

	const [updated] = await withUniqueName(db.update(schema.projectEntry).set(fields)
		.where(eq(schema.projectEntry.id, entry.id))
		.returning())
	// A download is named after the entry.
	if (fields.name && entry.fileId) await db.update(schema.file).set({ fileName: fields.name }).where(eq(schema.file.id, entry.fileId))
	return updated!
})
