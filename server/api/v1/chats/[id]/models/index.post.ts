import { createError, defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq, max } from 'drizzle-orm'
import { z } from 'zod'
import { chatAbilities } from '#shared/abilities/chatAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { findChat } from '#server/utils/chat/turns'
import { findChatModel, newLaneSchema, newLaneValues } from '#server/utils/chat/lanes'

const bodySchema = newLaneSchema.extend({
	/** Copies this lane of the chat; the other fields apply on top. */
	duplicateOf: z.uuid().optional(),
}).strict()

/** Owner only: adds a lane at the end, from fields, a profile, or a copy of another lane. It answers from the next message on. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const chat = await findChat(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, chatAbilities().manageChat, chat)
	const { duplicateOf, ...fields } = await readValidatedBody(event, bodySchema)

	let copied = {}
	if (duplicateOf) {
		const source = await findChatModel(db, chat!.id, duplicateOf)
		if (!source) throw createError({ status: 404, statusText: 'Model not found in this chat' })
		const { id: _, position: __, ...rest } = source
		copied = rest
	}
	const [last] = await db.select({ position: max(schema.chatModel.position) }).from(schema.chatModel).where(eq(schema.chatModel.chatId, chat!.id))
	const [lane] = await db.insert(schema.chatModel).values({
		...copied,
		...await newLaneValues(db, user.id, fields),
		chatId: chat!.id,
		position: (last?.position ?? -1) + 1,
	}).returning()
	const { chatId: _, createdAt: __, ...view } = lane!
	return view
})
