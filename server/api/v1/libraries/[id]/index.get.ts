import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { and, count, eq, inArray } from 'drizzle-orm'
import { libraryAbilities } from '#shared/abilities/libraryAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { findLibrary } from '#server/utils/library/libraries'

/** A library for the people in it, with the caller's `role`. The owner also gets the counts the delete dialog names. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const library = await findLibrary(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, libraryAbilities().readLibrary, library)
	const { members, ...view } = library!
	const role = view.ownerId === user.id ? 'owner' as const : members[user.id]!
	const counts = role === 'owner'
		? await Promise.all([
				db.select({ total: count() }).from(schema.libraryEntry).where(eq(schema.libraryEntry.libraryId, view.id)),
				db.select({ total: count() }).from(schema.chatLibrary).where(and(
					eq(schema.chatLibrary.libraryId, view.id),
					inArray(schema.chatLibrary.chatId, db.select({ id: schema.chat.id }).from(schema.chat).where(eq(schema.chat.userId, user.id))),
				)),
			])
		: undefined
	return {
		...view,
		role,
		counts: counts && { entries: counts[0][0]!.total, ownChats: counts[1][0]!.total },
	}
})
