import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { z } from 'zod'
import { chatSettingsSchema } from '#shared/utils/chat'
import type { Db } from '#server/utils/core/settings'
import { requireChat } from '#server/utils/chat/access'
import { listChatShares } from '#server/utils/chat/turns'

const bodySchema = z.object({
	title: z.string().trim().min(1).max(200),
	visibility: z.enum(['private', 'public']),
	settings: chatSettingsSchema,
	/** Replaces the list of people the chat is shared with. */
	sharedWith: z.array(z.uuid()).max(100),
}).partial().strict()

/** Owner only: title, link access, people, and the settings shared by every lane. */
export default defineEventHandler(async (event) => {
	const chat = await requireChat(event, 'manageChat')
	const { sharedWith, ...fields } = await readValidatedBody(event, bodySchema)

	// `updatedAt` keeps the update non-empty when only the people change.
	const update = (tx: Db) => tx.update(schema.chat).set({ ...fields, updatedAt: new Date() }).where(eq(schema.chat.id, chat.id)).returning()
	const view = ({ userId: _, ...row }: typeof schema.chat.$inferSelect, people: Awaited<ReturnType<typeof listChatShares>>) => ({ ...row, sharedWith: people })

	// Without new people, one statement, read alongside the people as they are.
	if (!sharedWith) {
		const [[row], people] = await Promise.all([update(db), listChatShares(db, chat.id)])
		return view(row!, people)
	}
	const [row] = await db.transaction(async (tx) => {
		const rows = await update(tx)
		await tx.delete(schema.chatShare).where(eq(schema.chatShare.chatId, chat.id))
		// Unknown ids and the owner are skipped.
		const people = sharedWith.length
			? await tx.select({ id: schema.user.id }).from(schema.user)
					.where(and(inArray(schema.user.id, sharedWith), ne(schema.user.id, chat.userId)))
			: []
		if (people.length) await tx.insert(schema.chatShare).values(people.map(person => ({ chatId: chat.id, userId: person.id })))
		return rows
	})
	return view(row!, await listChatShares(db, chat.id))
})
