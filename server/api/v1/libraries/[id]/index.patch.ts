import { defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { libraryAbilities } from '#shared/abilities/libraryAbilities'
import { authorize } from '#server/utils/core/authorize'
import { findLibrary, libraryDescriptionSchema, libraryNameSchema } from '#server/utils/library/libraries'
import { lorebookSchema } from '#shared/utils/lorebook'

const bodySchema = z.object({
	name: libraryNameSchema,
	description: libraryDescriptionSchema,
	/** The lorebook switch and the book's options; the kept card fields are left as they are. */
	lorebook: lorebookSchema.omit({ kept: true }),
}).partial().strict()
	.refine(fields => Object.keys(fields).length > 0, 'Nothing to change')

/** Renames the library, changes its description, or its lorebook switch and options. */
export default defineEventHandler(async (event) => {
	const library = await findLibrary(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, libraryAbilities().manageLibrary, library)
	const { name, description, lorebook } = await readValidatedBody(event, bodySchema)
	const [updated] = await db.update(schema.library)
		.set({ name, ...(description !== undefined && { description: description || null }), ...(lorebook && { lorebook: { ...lorebook, ...(library!.lorebook?.kept && { kept: library!.lorebook.kept }) } }) })
		.where(eq(schema.library.id, library!.id))
		.returning()
	return updated!
})
