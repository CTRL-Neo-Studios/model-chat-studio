import { defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { libraryAbilities } from '#shared/abilities/libraryAbilities'
import { authorize } from '#server/utils/core/authorize'
import { findLibrary, libraryDescriptionSchema, libraryNameSchema } from '#server/utils/library/libraries'

const bodySchema = z.object({
	name: libraryNameSchema,
	description: libraryDescriptionSchema,
}).partial().strict()
	.refine(fields => Object.keys(fields).length > 0, 'Nothing to change')

/** Renames the library or changes its description. */
export default defineEventHandler(async (event) => {
	const library = await findLibrary(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, libraryAbilities().manageLibrary, library)
	const { name, description } = await readValidatedBody(event, bodySchema)
	const [updated] = await db.update(schema.library)
		.set({ name, ...(description !== undefined && { description: description || null }) })
		.where(eq(schema.library.id, library!.id))
		.returning()
	return updated!
})
