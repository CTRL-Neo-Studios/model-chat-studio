import { defineEventHandler } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { desc, eq } from 'drizzle-orm'
import { useServerAuth } from '#server/utils/core/useServerAuth'

/** The member's own chats, newest first. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	return await db.select({
		id: schema.chat.id,
		title: schema.chat.title,
		visibility: schema.chat.visibility,
		createdAt: schema.chat.createdAt,
		updatedAt: schema.chat.updatedAt,
	}).from(schema.chat)
		.where(eq(schema.chat.userId, user.id))
		.orderBy(desc(schema.chat.createdAt))
})
