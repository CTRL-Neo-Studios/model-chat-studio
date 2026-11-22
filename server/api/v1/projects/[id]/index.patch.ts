import { defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { profileAbilities } from '#shared/abilities/profileAbilities'
import { projectAbilities } from '#shared/abilities/projectAbilities'
import { authorize } from '#server/utils/core/authorize'
import { findContextProfile } from '#server/utils/project/contextProfiles'
import { findProject, projectDescriptionSchema, projectNameSchema } from '#server/utils/project/projects'

const bodySchema = z.object({
	name: projectNameSchema,
	description: projectDescriptionSchema,
	/** The context profile the project's chats use; `null`: none. One of the owner's or an instance one. */
	contextProfileId: z.uuid().nullable(),
}).partial().strict()
	.refine(fields => Object.keys(fields).length > 0, 'Nothing to change')

/** Renames the project, changes its description, or sets its default context profile. */
export default defineEventHandler(async (event) => {
	const project = await findProject(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, projectAbilities().manageProject, project)
	const { name, description, contextProfileId } = await readValidatedBody(event, bodySchema)
	if (contextProfileId) await authorize(event, profileAbilities().readProfile, await findContextProfile(db, contextProfileId))
	const [updated] = await db.update(schema.project)
		.set({ name, contextProfileId, ...(description !== undefined && { description: description || null }) })
		.where(eq(schema.project.id, project!.id))
		.returning()
	return updated!
})
