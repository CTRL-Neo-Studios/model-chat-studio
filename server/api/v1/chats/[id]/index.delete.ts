import { defineEventHandler } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { requireChat } from '#server/utils/chat/access'
import { deleteStoredFiles } from '#server/utils/chat/files'

/** Owner only. Messages, votes and shares go with the chat; its files are deleted from storage too. */
export default defineEventHandler(async (event) => {
	const chat = await requireChat(event, 'manageChat')
	const user = await useServerAuth().requireUser(event)

	const files = await db.select({ id: schema.file.id }).from(schema.file).where(eq(schema.file.chatId, chat.id))
	await deleteStoredFiles(db, files.map(file => file.id), user.id)
	await db.delete(schema.chat).where(eq(schema.chat.id, chat.id))
	return { id: chat.id }
})
