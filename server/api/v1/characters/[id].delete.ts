import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { profileAbilities } from '#shared/abilities/profileAbilities'
import { authorize } from '#server/utils/core/authorize'
import { findCharacter } from '#server/utils/chat/characters'

/** Deletes a Character; lanes, profiles and chats using it go back to none. */
export default defineEventHandler(async (event) => {
	const found = await findCharacter(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, profileAbilities().manageProfile, found)
	await db.delete(schema.character).where(eq(schema.character.id, found!.id))
	return { id: found!.id }
})
