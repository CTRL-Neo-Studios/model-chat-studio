import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { count, eq } from 'drizzle-orm'
import { requireChat } from '#server/utils/chat/access'
import { findChatModel } from '#server/utils/chat/lanes'

/** Owner only: removes a lane. Its answers stay in the chat, no longer tied to a lane. */
export default defineEventHandler(async (event) => {
	const chat = await requireChat(event, 'manageChat')
	const [lane, [lanes]] = await Promise.all([
		findChatModel(db, chat.id, getRouterParam(event, 'laneId', { decode: true })),
		db.select({ count: count() }).from(schema.chatModel).where(eq(schema.chatModel.chatId, chat.id)),
	])
	if (!lane) throw createError({ status: 404, statusText: 'Model not found in this chat' })
	if (lanes!.count <= 1) throw createError({ status: 400, statusText: 'A chat needs at least one model' })
	await db.delete(schema.chatModel).where(eq(schema.chatModel.id, lane.id))
	return { id: lane.id }
})
