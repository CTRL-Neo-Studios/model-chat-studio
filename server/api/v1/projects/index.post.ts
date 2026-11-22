import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { z } from 'zod'
import { projectAbilities } from '#shared/abilities/projectAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { projectDescriptionSchema, projectNameSchema } from '#server/utils/project/projects'

const bodySchema = z.object({
	name: projectNameSchema,
	description: projectDescriptionSchema.optional(),
}).strict()

export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	await authorize(event, projectAbilities().useProjects)
	const { name, description } = await readValidatedBody(event, bodySchema)
	const [project] = await db.insert(schema.project).values({ ownerId: user.id, name, description: description || null }).returning()
	return project!
})
