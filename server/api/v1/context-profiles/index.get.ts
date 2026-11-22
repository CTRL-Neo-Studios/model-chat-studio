import { defineEventHandler } from 'nuxt/server'
import { db } from 'hub:db'
import { profileAbilities } from '#shared/abilities/profileAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { listContextProfiles } from '#server/utils/project/contextProfiles'

/** The member's own context profiles and the instance ones (`ownerId` `null`). */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	await authorize(event, profileAbilities().useProfiles)
	return await listContextProfiles(db, user.id)
})
