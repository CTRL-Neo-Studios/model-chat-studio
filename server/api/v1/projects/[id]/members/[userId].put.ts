import { createError, defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { projectAbilities } from '#shared/abilities/projectAbilities'
import { authorize } from '#server/utils/core/authorize'
import { findProject } from '#server/utils/project/projects'

const bodySchema = z.object({ role: z.enum(schema.projectRoles) }).strict()

/** The owner shares the project with someone, or changes their role. */
export default defineEventHandler(async (event) => {
	const project = await findProject(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, projectAbilities().manageProject, project)
	const userId = getRouterParam(event, 'userId', { decode: true })
	const { role } = await readValidatedBody(event, bodySchema)
	if (!z.uuid().safeParse(userId).success) throw createError({ status: 404, statusText: 'Person not found' })
	if (userId === project!.ownerId) throw createError({ status: 400, statusText: 'The owner already has every right' })
	const [person] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, userId!))
	if (!person) throw createError({ status: 404, statusText: 'Person not found' })
	await db.insert(schema.projectMember).values({ projectId: project!.id, userId: person.id, role })
		.onConflictDoUpdate({ target: [schema.projectMember.projectId, schema.projectMember.userId], set: { role } })
	return { userId: person.id, role }
})
