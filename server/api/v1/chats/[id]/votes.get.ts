import { defineEventHandler } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { requireChat } from '#server/utils/chat/access'

export default defineEventHandler(async (event) => {
	const chat = await requireChat(event, 'manageChat')
	return await db.select().from(schema.vote).where(eq(schema.vote.chatId, chat.id))
})
