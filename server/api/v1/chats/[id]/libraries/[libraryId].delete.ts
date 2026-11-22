import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { and, eq } from 'drizzle-orm'
import { requireChat } from '#server/utils/chat/access'

/** The owner takes a library off the chat. Its "@" references in old messages are left out from then on. */
export default defineEventHandler(async (event) => {
	const chat = await requireChat(event, 'manageChat')
	const libraryId = getRouterParam(event, 'libraryId', { decode: true }) ?? ''
	await db.delete(schema.chatLibrary).where(and(eq(schema.chatLibrary.chatId, chat.id), eq(schema.chatLibrary.libraryId, libraryId)))
	return { id: libraryId }
})
