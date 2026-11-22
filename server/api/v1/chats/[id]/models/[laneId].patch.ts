import { createError, defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { laneFieldsSchema } from '#shared/utils/chat'
import { requireChat } from '#server/utils/chat/access'
import { assertLaneLimit, countEnabledLanes, findChatModel, laneValues } from '#server/utils/chat/lanes'
import { assertCharacterUsable } from '#server/utils/chat/characters'

const bodySchema = laneFieldsSchema.partial().extend({
	/** Display order; the client swaps two lanes' positions to move one. */
	position: z.number().int().min(0).max(1000),
}).partial().strict()
	.refine(fields => Object.keys(fields).length > 0, 'Nothing to change')

/** Owner only: changes a lane. Answers already given keep the model that wrote them. */
export default defineEventHandler(async (event) => {
	const chat = await requireChat(event, 'manageChat')
	const fields = await readValidatedBody(event, bodySchema)
	const [lane, enabled] = await Promise.all([
		findChatModel(db, chat.id, getRouterParam(event, 'laneId', { decode: true })),
		fields.enabled ? countEnabledLanes(db, chat.id) : 0,
	])
	if (!lane) throw createError({ status: 404, statusText: 'Model not found in this chat' })
	if (fields.enabled && !lane.enabled) await assertLaneLimit(db, enabled + 1)
	await assertCharacterUsable(db, chat.userId, fields.characterId)

	const [updated] = await db.update(schema.chatModel).set(await laneValues(db, fields))
		.where(eq(schema.chatModel.id, lane.id))
		.returning()
	const { chatId: _, createdAt: __, ...view } = updated!
	return view
})
