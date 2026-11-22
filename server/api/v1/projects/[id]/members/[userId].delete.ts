import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { and, eq } from 'drizzle-orm'
import { projectAbilities } from '#shared/abilities/projectAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { detachProjectChats, findProject } from '#server/utils/project/projects'

/** The owner removes someone, or someone leaves. Their chats in the project become ordinary chats. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const project = await findProject(db, getRouterParam(event, 'id', { decode: true }))
	const userId = getRouterParam(event, 'userId', { decode: true })
	await authorize(event, userId === user.id ? projectAbilities().readProject : projectAbilities().manageProject, project)
	if (!userId || !project!.members[userId]) throw createError({ status: 404, statusText: 'This person is not in the project' })

	await db.delete(schema.projectMember).where(and(eq(schema.projectMember.projectId, project!.id), eq(schema.projectMember.userId, userId)))
	await detachProjectChats(db, project!.id, userId)
	return { userId }
})
