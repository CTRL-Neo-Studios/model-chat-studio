import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { count, eq } from 'drizzle-orm'
import { libraryAbilities } from '#shared/abilities/libraryAbilities'
import { authorize } from '#server/utils/core/authorize'
import { requireChat } from '#server/utils/chat/access'
import { findLibrary, MAX_CHAT_LIBRARIES } from '#server/utils/library/libraries'

/** The owner attaches a library they may read; it comes last in attach order. Attaching it again changes nothing. */
export default defineEventHandler(async (event) => {
	const chat = await requireChat(event, 'manageChat')
	const library = await findLibrary(db, getRouterParam(event, 'libraryId', { decode: true }))
	await authorize(event, libraryAbilities().readLibrary, library)
	const [attached] = await db.select({ total: count() }).from(schema.chatLibrary).where(eq(schema.chatLibrary.chatId, chat.id))
	if ((attached?.total ?? 0) >= MAX_CHAT_LIBRARIES) throw createError({ status: 400, statusText: `A chat reads at most ${MAX_CHAT_LIBRARIES} libraries. Remove one first.` })
	await db.insert(schema.chatLibrary).values({ chatId: chat.id, libraryId: library!.id }).onConflictDoNothing()
	return { id: library!.id, name: library!.name }
})
