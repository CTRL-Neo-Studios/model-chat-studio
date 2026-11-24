import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { asc, inArray } from 'drizzle-orm'
import { libraryAbilities } from '#shared/abilities/libraryAbilities'
import { authorize } from '#server/utils/core/authorize'
import { findLibrary } from '#server/utils/library/libraries'

/** The library's owner and the people it is shared with, as the share dialog shows them. */
export default defineEventHandler(async (event) => {
	const library = await findLibrary(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, libraryAbilities().readLibrary, library)
	const ids = [library!.ownerId, ...Object.keys(library!.members)]
	const people = await db.select({ id: schema.user.id, username: schema.user.username, name: schema.user.name, avatarUrl: schema.user.avatarUrl })
		.from(schema.user).where(inArray(schema.user.id, ids)).orderBy(asc(schema.user.username))
	const role = (id: string) => id === library!.ownerId ? 'owner' as const : library!.members[id]!
	return people.map(person => ({ ...person, role: role(person.id) })).sort((a, b) => Number(b.role === 'owner') - Number(a.role === 'owner'))
})
