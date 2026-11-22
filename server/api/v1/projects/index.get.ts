import { defineEventHandler } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { desc, eq } from 'drizzle-orm'
import { projectAbilities } from '#shared/abilities/projectAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'

/** The member's projects, most recently changed first. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	await authorize(event, projectAbilities().useProjects)
	return await db.select().from(schema.project)
		.where(eq(schema.project.ownerId, user.id))
		.orderBy(desc(schema.project.updatedAt))
})
