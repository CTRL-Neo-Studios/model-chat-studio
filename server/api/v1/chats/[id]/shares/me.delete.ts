import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { useServerAuth } from '#server/utils/core/useServerAuth'

/** Leaving a chat shared with the member, as a viewer or an editor (milestone 11). Anyone else is told it does not exist. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const chatId = getRouterParam(event, 'id', { decode: true })
	if (!z.uuid().safeParse(chatId).success) throw createError({ status: 404, statusText: 'Chat not found' })
	const [left] = await db.delete(schema.chatShare)
		.where(and(eq(schema.chatShare.chatId, chatId!), eq(schema.chatShare.userId, user.id)))
		.returning({ chatId: schema.chatShare.chatId })
	if (!left) throw createError({ status: 404, statusText: 'Chat not found' })
	return { chatId: left.chatId }
})
