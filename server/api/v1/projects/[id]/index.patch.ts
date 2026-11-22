import { defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { projectAbilities } from '#shared/abilities/projectAbilities'
import { authorize } from '#server/utils/core/authorize'
import { findProject, projectDescriptionSchema, projectNameSchema } from '#server/utils/project/projects'

const bodySchema = z.object({
	name: projectNameSchema,
	description: projectDescriptionSchema,
}).partial().strict()
	.refine(fields => Object.keys(fields).length > 0, 'Nothing to change')

/** Renames the project or changes its description. */
export default defineEventHandler(async (event) => {
	const project = await findProject(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, projectAbilities().manageProject, project)
	const { name, description } = await readValidatedBody(event, bodySchema)
	const [updated] = await db.update(schema.project)
		.set({ name, ...(description !== undefined && { description: description || null }) })
		.where(eq(schema.project.id, project!.id))
		.returning()
	return updated!
})
