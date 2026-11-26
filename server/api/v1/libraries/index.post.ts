import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { z } from 'zod'
import { libraryAbilities } from '#shared/abilities/libraryAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { libraryDescriptionSchema, libraryNameSchema } from '#shared/utils/libraryFields'

const bodySchema = z.object({
	name: libraryNameSchema,
	description: libraryDescriptionSchema.optional(),
}).strict()

export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	await authorize(event, libraryAbilities().useLibraries)
	const { name, description } = await readValidatedBody(event, bodySchema)
	const [library] = await db.insert(schema.library).values({ ownerId: user.id, name, description: description || null }).returning()
	return library!
})
