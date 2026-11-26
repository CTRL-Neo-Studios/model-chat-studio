import { defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { z } from 'zod'
import { libraryAbilities } from '#shared/abilities/libraryAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { assertEntryParent, entryColumns, findLibrary, listEntries, withUniqueName } from '#server/utils/library/libraries'
import { entryNameSchema, noteContentSchema, tagsSchema } from '#shared/utils/libraryFields'

const bodySchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('folder') }),
	z.object({ kind: z.literal('note'), content: noteContentSchema.default('') }),
]).and(z.object({
	name: entryNameSchema,
	/** `null` or absent: top level. */
	parentId: z.uuid().nullable().default(null),
	tags: tagsSchema.default([]),
}))

/** Creates a folder or a note. Files arrive through `PUT /libraries/:id/files`. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const library = await findLibrary(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, libraryAbilities().editFiles, library)
	const body = await readValidatedBody(event, bodySchema)
	assertEntryParent(await listEntries(db, library!.id), body.parentId)

	const [entry] = await withUniqueName(db.insert(schema.libraryEntry).values({
		libraryId: library!.id,
		parentId: body.parentId,
		kind: body.kind,
		name: body.name,
		tags: body.tags,
		content: body.kind === 'note' ? body.content : null,
		createdBy: user.id,
	}).returning(entryColumns))
	return entry!
})
