import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { and, asc, ilike, ne, or } from 'drizzle-orm'
import { z } from 'zod'
import { useServerAuth } from '#server/utils/core/useServerAuth'

/** People to share a chat with, by username or name. Every member can see the other members' names. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const { q } = await getValidatedQuery(event, z.object({ q: z.string().trim().min(2).max(64) }))
	const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`

	return await db.select({
		id: schema.user.id,
		username: schema.user.username,
		name: schema.user.name,
		avatarUrl: schema.user.avatarUrl,
	}).from(schema.user)
		.where(and(ne(schema.user.id, user.id), or(ilike(schema.user.username, pattern), ilike(schema.user.name, pattern))))
		.orderBy(asc(schema.user.username))
		.limit(10)
})
