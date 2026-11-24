import { createError, defineEventHandler, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq, max } from 'drizzle-orm'
import { z } from 'zod'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { requireChat } from '#server/utils/chat/access'
import { assertLaneLimit, countEnabledLanes, findChatModel, newLaneValues } from '#server/utils/chat/lanes'
import { newLaneSchema } from '#shared/utils/chat'

const bodySchema = newLaneSchema.extend({
	/** Copies this lane of the chat; the other fields apply on top. */
	duplicateOf: z.uuid().optional(),
}).strict()

/** Owner only: adds a lane at the end, from fields, a profile, or a copy of another lane. It answers from the next message on. */
export default defineEventHandler(async (event) => {
	const chat = await requireChat(event, 'manageChat')
	const user = await useServerAuth().requireUser(event)
	const { duplicateOf, ...fields } = await readValidatedBody(event, bodySchema)

	const [source, laneFields, enabled, [last]] = await Promise.all([
		duplicateOf ? findChatModel(db, chat.id, duplicateOf) : undefined,
		newLaneValues(db, user.id, fields),
		countEnabledLanes(db, chat.id),
		db.select({ position: max(schema.chatModel.position) }).from(schema.chatModel).where(eq(schema.chatModel.chatId, chat.id)),
	])
	if (duplicateOf && !source) throw createError({ status: 404, statusText: 'Model not found in this chat' })
	let copied: { enabled?: boolean } = {}
	if (source) {
		const { id: _, position: __, ...rest } = source
		copied = rest
	}
	const values = { ...copied, ...laneFields }
	if (values.enabled ?? true) await assertLaneLimit(db, enabled + 1)
	const [lane] = await db.insert(schema.chatModel).values({
		...values,
		chatId: chat.id,
		position: (last?.position ?? -1) + 1,
	}).returning()
	const { chatId: _, createdAt: __, ...view } = lane!
	return view
})
