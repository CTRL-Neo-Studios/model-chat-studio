import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { asc, inArray } from 'drizzle-orm'
import { projectAbilities } from '#shared/abilities/projectAbilities'
import { authorize } from '#server/utils/core/authorize'
import { findProject } from '#server/utils/project/projects'

/** The project's owner and the people it is shared with, as the share dialog shows them. */
export default defineEventHandler(async (event) => {
	const project = await findProject(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, projectAbilities().readProject, project)
	const ids = [project!.ownerId, ...Object.keys(project!.members)]
	const people = await db.select({ id: schema.user.id, username: schema.user.username, name: schema.user.name, avatarUrl: schema.user.avatarUrl })
		.from(schema.user).where(inArray(schema.user.id, ids)).orderBy(asc(schema.user.username))
	const role = (id: string) => id === project!.ownerId ? 'owner' as const : project!.members[id]!
	return people.map(person => ({ ...person, role: role(person.id) })).sort((a, b) => Number(b.role === 'owner') - Number(a.role === 'owner'))
})
