import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { and, desc, eq, ne } from 'drizzle-orm'
import { projectAbilities } from '#shared/abilities/projectAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { findProject } from '#server/utils/project/projects'

/** Other people's chats in the project that they made visible to it, newest first. One's own come with `GET /chats`. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const project = await findProject(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, projectAbilities().readProject, project)
	return await db.select({
		id: schema.chat.id,
		title: schema.chat.title,
		createdAt: schema.chat.createdAt,
		author: { id: schema.user.id, username: schema.user.username, name: schema.user.name },
	}).from(schema.chat)
		.innerJoin(schema.user, eq(schema.user.id, schema.chat.userId))
		.where(and(eq(schema.chat.projectId, project!.id), eq(schema.chat.projectVisible, true), ne(schema.chat.userId, user.id)))
		.orderBy(desc(schema.chat.createdAt))
})
