import { defineEventHandler } from 'nuxt/server'
import { db } from 'hub:db'
import { profileAbilities } from '#shared/abilities/profileAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { listCharacters } from '#server/utils/chat/characters'

/** The member's own Characters and the instance ones (`ownerId` `null`), each with its `libraryIds`. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	await authorize(event, profileAbilities().useProfiles)
	return await listCharacters(db, user.id)
})
