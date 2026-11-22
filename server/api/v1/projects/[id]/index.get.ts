import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { and, count, eq, ne } from 'drizzle-orm'
import { projectAbilities } from '#shared/abilities/projectAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { findContextProfile } from '#server/utils/project/contextProfiles'
import { findProject } from '#server/utils/project/projects'

/**
 * A project for the people in it, with the caller's `role` and the name of its default context profile (which may be
 * the owner's own). The owner also gets the counts the delete dialog names.
 */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const project = await findProject(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, projectAbilities().readProject, project)
	const { members, ...view } = project!
	const role = view.ownerId === user.id ? 'owner' as const : members[user.id]!
	const [profile, counts] = await Promise.all([
		findContextProfile(db, view.contextProfileId),
		role === 'owner'
			? Promise.all([
					db.select({ total: count() }).from(schema.projectEntry).where(eq(schema.projectEntry.projectId, view.id)),
					db.select({ total: count() }).from(schema.chat).where(and(eq(schema.chat.projectId, view.id), eq(schema.chat.userId, user.id))),
					db.select({ total: count() }).from(schema.chat).where(and(eq(schema.chat.projectId, view.id), ne(schema.chat.userId, user.id))),
				])
			: undefined,
	])
	return {
		...view,
		role,
		contextProfileName: profile?.name ?? null,
		counts: counts && { entries: counts[0][0]!.total, ownChats: counts[1][0]!.total, otherChats: counts[2][0]!.total },
	}
})
