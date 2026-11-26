import { defineEventHandler } from 'nuxt/server'
import { db } from 'hub:db'
import { exploreAbilities } from '#shared/abilities/exploreAbilities'
import { authorize } from '#server/utils/core/authorize'
import { allListings } from '#server/utils/explore/browse'

/** Admins and moderators: every listing on Explore, whatever its status. */
export default defineEventHandler(async (event) => {
	await authorize(event, exploreAbilities().moderateExplore)
	return await allListings(db)
})
