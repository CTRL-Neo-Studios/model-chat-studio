import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { chatAbilities } from '#shared/abilities/chatAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { findChat } from '#server/utils/chat/turns'
import { deleteStoredFiles } from '#server/utils/chat/files'
import { useInference } from '#server/utils/inference'

/** Owner only. Messages, votes and shares go with the chat; its files are deleted from storage too. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const chat = await findChat(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, chatAbilities().manageChat, chat)

	const files = await db.select({ id: schema.file.id }).from(schema.file).where(eq(schema.file.chatId, chat!.id))
	await deleteStoredFiles(db, files.map(file => file.id), await useInference(db, user.id))
	await db.delete(schema.chat).where(eq(schema.chat.id, chat!.id))
	return { id: chat!.id }
})
