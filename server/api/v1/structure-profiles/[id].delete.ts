import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { profileAbilities } from '#shared/abilities/profileAbilities'
import { authorize } from '#server/utils/core/authorize'
import { findStructureProfile } from '#server/utils/chat/structureProfiles'

/** Deletes a structure profile; chats using it go back to none. */
export default defineEventHandler(async (event) => {
	const profile = await findStructureProfile(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, profileAbilities().manageProfile, profile)
	await db.delete(schema.structureProfile).where(eq(schema.structureProfile.id, profile!.id))
	return { id: profile!.id }
})
