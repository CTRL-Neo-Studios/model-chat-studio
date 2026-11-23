import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { profileAbilities } from '#shared/abilities/profileAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { findCharacter } from '#server/utils/chat/characters'
import { deleteStoredFiles } from '#server/utils/chat/files'

/** Removes a Character's avatar; its colour dot shows again. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const found = await findCharacter(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, profileAbilities().manageProfile, found)
	await db.update(schema.character).set({ avatarFileId: null, updatedAt: new Date() }).where(eq(schema.character.id, found!.id))
	if (found!.avatarFileId) await deleteStoredFiles(db, [found!.avatarFileId], user.id)
	return (await findCharacter(db, found!.id))!
})
