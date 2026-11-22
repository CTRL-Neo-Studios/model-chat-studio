import { defineEventHandler } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { desc, eq, getTableColumns, or, sql } from 'drizzle-orm'
import { projectAbilities } from '#shared/abilities/projectAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'

/** The member's projects and the ones shared with them, most recently changed first, each with the member's `role`. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	await authorize(event, projectAbilities().useProjects)
	return await db.select({
		...getTableColumns(schema.project),
		role: sql<'owner' | 'viewer' | 'member' | 'editor'>`coalesce(${schema.projectMember.role}, 'owner')`,
	}).from(schema.project)
		.leftJoin(schema.projectMember, sql`${schema.projectMember.projectId} = ${schema.project.id} and ${schema.projectMember.userId} = ${user.id}`)
		.where(or(eq(schema.project.ownerId, user.id), eq(schema.projectMember.userId, user.id)))
		.orderBy(desc(schema.project.updatedAt))
})
