import { defineEventHandler } from 'nuxt/server'
import { db } from 'hub:db'
import { exploreAbilities } from '#shared/abilities/exploreAbilities'
import { authorize } from '#server/utils/core/authorize'
import { pendingReviews } from '#server/utils/explore/reviews'

/** Admins and moderators: what waits for review, oldest first. */
export default defineEventHandler(async (event) => {
	await authorize(event, exploreAbilities().moderateExplore)
	return { pending: await pendingReviews(db) }
})
