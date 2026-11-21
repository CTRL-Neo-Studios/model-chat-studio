import { createError, defineEventHandler, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { z } from 'zod'
import { chatParamsSchema } from '#shared/utils/chat'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { userMessageSchema } from '#server/utils/chat/turns'

const bodySchema = z.object({
	id: z.uuid(),
	message: userMessageSchema,
	params: chatParamsSchema.optional(),
	systemPrompt: z.string().trim().max(20_000).optional(),
})

/** Creates a chat with its first message. The answer is requested with `POST /chats/:id`. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const { id, message, params, systemPrompt } = await readValidatedBody(event, bodySchema)

	return await db.transaction(async (tx) => {
		const [chat] = await tx.insert(schema.chat).values({ id, userId: user.id, params, systemPrompt: systemPrompt || null }).onConflictDoNothing().returning()
		const [saved] = chat
			? await tx.insert(schema.message).values({ id: message.id, chatId: id, role: 'user', parts: message.parts }).onConflictDoNothing().returning()
			: []
		if (!chat || !saved) throw createError({ status: 409, statusText: 'This id is already in use' })
		const { userId: _, ...view } = chat
		return view
	})
})
