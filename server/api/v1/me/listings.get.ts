import { defineEventHandler } from 'nuxt/server'
import { db } from 'hub:db'
import { exploreAbilities } from '#shared/abilities/exploreAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { myListings } from '#server/utils/explore/listings'

/** The member's own listings, whatever their status, with a removed one's reason. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	await authorize(event, exploreAbilities().useExplore)
	return await myListings(db, user.id)
})
