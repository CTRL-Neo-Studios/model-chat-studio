import { defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { z } from 'zod'
import { chatAbilities } from '#shared/abilities/chatAbilities'
import { chatParamsSchema } from '#shared/utils/chat'
import { authorize } from '#server/utils/core/authorize'
import { findChat, listChatShares } from '#server/utils/chat/turns'

const bodySchema = z.object({
	title: z.string().trim().min(1).max(200),
	visibility: z.enum(['private', 'public']),
	systemPrompt: z.string().trim().max(20_000).nullable(),
	params: chatParamsSchema,
	/** Replaces the list of people the chat is shared with. */
	sharedWith: z.array(z.uuid()).max(100),
}).partial().strict()

/** Owner only: title, link access, people, system prompt, model settings. */
export default defineEventHandler(async (event) => {
	const chat = await findChat(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, chatAbilities().manageChat, chat)
	const { sharedWith, systemPrompt, ...fields } = await readValidatedBody(event, bodySchema)

	const updated = await db.transaction(async (tx) => {
		const [row] = await tx.update(schema.chat)
			// `updatedAt` keeps the update non-empty when only the people change.
			.set({ ...fields, ...(systemPrompt !== undefined && { systemPrompt: systemPrompt || null }), updatedAt: new Date() })
			.where(eq(schema.chat.id, chat!.id))
			.returning()
		if (sharedWith) {
			await tx.delete(schema.chatShare).where(eq(schema.chatShare.chatId, chat!.id))
			// Unknown ids and the owner are skipped.
			const people = sharedWith.length
				? await tx.select({ id: schema.user.id }).from(schema.user)
						.where(and(inArray(schema.user.id, sharedWith), ne(schema.user.id, chat!.userId)))
				: []
			if (people.length) await tx.insert(schema.chatShare).values(people.map(person => ({ chatId: chat!.id, userId: person.id })))
		}
		return row!
	})

	const { userId: _, ...view } = updated
	return { ...view, sharedWith: await listChatShares(db, view.id) }
})
