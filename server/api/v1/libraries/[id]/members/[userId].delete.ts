import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { and, eq } from 'drizzle-orm'
import { libraryAbilities } from '#shared/abilities/libraryAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { detachLibrary, findLibrary } from '#server/utils/library/libraries'

/** The owner removes someone, or someone leaves. The library comes off their chats. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const library = await findLibrary(db, getRouterParam(event, 'id', { decode: true }))
	const userId = getRouterParam(event, 'userId', { decode: true })
	await authorize(event, userId === user.id ? libraryAbilities().readLibrary : libraryAbilities().manageLibrary, library)
	if (!userId || !library!.members[userId]) throw createError({ status: 404, statusText: 'This person is not in the library' })

	await db.delete(schema.libraryMember).where(and(eq(schema.libraryMember.libraryId, library!.id), eq(schema.libraryMember.userId, userId)))
	await detachLibrary(db, library!.id, userId)
	return { userId }
})
