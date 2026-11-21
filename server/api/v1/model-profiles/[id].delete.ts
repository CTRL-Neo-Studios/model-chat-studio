import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { profileAbilities } from '#shared/abilities/profileAbilities'
import { authorize } from '#server/utils/core/authorize'
import { findModelProfile } from '#server/utils/chat/profiles'

/** Deletes a profile: the owner's own, or an instance profile by an admin. Lanes started from it stay. */
export default defineEventHandler(async (event) => {
	const profile = await findModelProfile(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, profileAbilities().manageProfile, profile)
	await db.delete(schema.modelProfile).where(eq(schema.modelProfile.id, profile!.id))
	return { id: profile!.id }
})
