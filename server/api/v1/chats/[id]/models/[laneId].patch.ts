import { createError, defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { chatAbilities } from '#shared/abilities/chatAbilities'
import { laneFieldsSchema } from '#shared/utils/chat'
import { authorize } from '#server/utils/core/authorize'
import { findChat } from '#server/utils/chat/turns'
import { findChatModel, laneValues } from '#server/utils/chat/lanes'

const bodySchema = laneFieldsSchema.partial().extend({
	/** Display order; the client swaps two lanes' positions to move one. */
	position: z.number().int().min(0).max(1000),
}).partial().strict()
	.refine(fields => Object.keys(fields).length > 0, 'Nothing to change')

/** Owner only: changes a lane. Answers already given keep the model that wrote them. */
export default defineEventHandler(async (event) => {
	const chat = await findChat(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, chatAbilities().manageChat, chat)
	const lane = await findChatModel(db, chat!.id, getRouterParam(event, 'laneId', { decode: true }))
	if (!lane) throw createError({ status: 404, statusText: 'Model not found in this chat' })
	const fields = await readValidatedBody(event, bodySchema)

	const [updated] = await db.update(schema.chatModel).set(await laneValues(db, fields))
		.where(eq(schema.chatModel.id, lane.id))
		.returning()
	const { chatId: _, createdAt: __, ...view } = updated!
	return view
})
