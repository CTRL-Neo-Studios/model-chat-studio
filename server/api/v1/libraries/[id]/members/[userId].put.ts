import { createError, defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { libraryAbilities } from '#shared/abilities/libraryAbilities'
import { authorize } from '#server/utils/core/authorize'
import { findLibrary } from '#server/utils/library/libraries'

const bodySchema = z.object({ role: z.enum(schema.libraryRoles) }).strict()

/** The owner shares the library with someone, or changes their role. */
export default defineEventHandler(async (event) => {
	const library = await findLibrary(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, libraryAbilities().manageLibrary, library)
	const userId = getRouterParam(event, 'userId', { decode: true })
	const { role } = await readValidatedBody(event, bodySchema)
	if (!z.uuid().safeParse(userId).success) throw createError({ status: 404, statusText: 'Person not found' })
	if (userId === library!.ownerId) throw createError({ status: 400, statusText: 'The owner already has every right' })
	const [person] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, userId!))
	if (!person) throw createError({ status: 404, statusText: 'Person not found' })
	await db.insert(schema.libraryMember).values({ libraryId: library!.id, userId: person.id, role })
		.onConflictDoUpdate({ target: [schema.libraryMember.libraryId, schema.libraryMember.userId], set: { role } })
	return { userId: person.id, role }
})
