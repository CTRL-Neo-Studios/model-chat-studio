import { defineEventHandler } from 'nuxt/server'
import { db } from 'hub:db'
import { exploreAbilities } from '#shared/abilities/exploreAbilities'
import { authorize } from '#server/utils/core/authorize'
import { pendingReviews } from '#server/utils/explore/reviews'
import { openReports } from '#server/utils/explore/reports'

/** Admins and moderators: what waits for review, and the open reports, oldest first. */
export default defineEventHandler(async (event) => {
	await authorize(event, exploreAbilities().moderateExplore)
	const [pending, reports] = await Promise.all([pendingReviews(db), openReports(db)])
	return { pending, reports }
})
