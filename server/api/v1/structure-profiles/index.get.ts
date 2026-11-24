import { defineEventHandler } from 'nuxt/server'
import { db } from 'hub:db'
import { profileAbilities } from '#shared/abilities/profileAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { listStructureProfiles } from '#server/utils/chat/structureProfiles'

/** The member's own structure profiles and the instance ones (`ownerId` `null`). */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	await authorize(event, profileAbilities().useProfiles)
	return await listStructureProfiles(db, user.id)
})
