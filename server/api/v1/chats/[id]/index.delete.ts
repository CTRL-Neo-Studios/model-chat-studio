import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { chatAbilities } from '#shared/abilities/chatAbilities'
import { authorize } from '#server/utils/core/authorize'
import { findChat } from '#server/utils/chat/turns'

/** Owner only. Messages, votes and shares go with the chat. */
export default defineEventHandler(async (event) => {
	const chat = await findChat(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, chatAbilities().manageChat, chat)
	// ponytail: phase 7 adds deleting the chat's blobs, remote files and file rows here, with the file routes.
	await db.delete(schema.chat).where(eq(schema.chat.id, chat!.id))
	return { id: chat!.id }
})
