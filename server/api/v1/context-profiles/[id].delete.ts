import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { profileAbilities } from '#shared/abilities/profileAbilities'
import { authorize } from '#server/utils/core/authorize'
import { findContextProfile } from '#server/utils/project/contextProfiles'

/** Deletes a context profile; projects and chats using it go back to none (or to the project's). */
export default defineEventHandler(async (event) => {
	const profile = await findContextProfile(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, profileAbilities().manageProfile, profile)
	await db.delete(schema.contextProfile).where(eq(schema.contextProfile.id, profile!.id))
	return { id: profile!.id }
})
