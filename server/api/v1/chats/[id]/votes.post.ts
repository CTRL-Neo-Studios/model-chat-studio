import { createError, defineEventHandler, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireChat } from '#server/utils/chat/access'

const bodySchema = z.object({
	messageId: z.string().min(1),
	/** Omitted removes the vote. */
	isUpvoted: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
	const chat = await requireChat(event, 'writeChat')
	const { messageId, isUpvoted } = await readValidatedBody(event, bodySchema)
	const chatId = chat.id

	const [message] = await db.select({ role: schema.message.role }).from(schema.message)
		.where(and(eq(schema.message.id, messageId), eq(schema.message.chatId, chatId)))
	if (!message) throw createError({ status: 404, statusText: 'Message not found' })
	if (message.role !== 'assistant') throw createError({ status: 400, statusText: 'Only answers can be voted on' })

	if (isUpvoted === undefined) {
		await db.delete(schema.vote).where(and(eq(schema.vote.chatId, chatId), eq(schema.vote.messageId, messageId)))
	}
	else {
		await db.insert(schema.vote).values({ chatId, messageId, isUpvoted })
			.onConflictDoUpdate({ target: [schema.vote.chatId, schema.vote.messageId], set: { isUpvoted } })
	}
	return { chatId, messageId, isUpvoted }
})
