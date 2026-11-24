import { defineEventHandler } from 'nuxt/server'
import { db } from 'hub:db'
import { profileAbilities } from '#shared/abilities/profileAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { listModelProfiles } from '#server/utils/chat/profiles'

/** The member's own profiles and the instance profiles (`ownerId` `null`). */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	await authorize(event, profileAbilities().useProfiles)
	return await listModelProfiles(db, user.id)
})
