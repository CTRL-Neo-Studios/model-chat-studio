import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { chatAbilities } from '#shared/abilities/chatAbilities'
import { authorize } from '#server/utils/core/authorize'
import { findChat } from '#server/utils/chat/turns'

export default defineEventHandler(async (event) => {
	const chat = await findChat(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, chatAbilities().manageChat, chat)
	return await db.select().from(schema.vote).where(eq(schema.vote.chatId, chat!.id))
})
