import { defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db } from 'hub:db'
import { z } from 'zod'
import { exploreAbilities } from '#shared/abilities/exploreAbilities'
import { authorize } from '#server/utils/core/authorize'
import { assertRateLimit } from '#server/utils/core/rateLimit'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { findListing } from '#server/utils/explore/listings'
import { reportListing, reportReasonSchema } from '#server/utils/explore/reports'

const bodySchema = z.object({ reason: reportReasonSchema }).strict()

/** A member reports a listing they can see, with a reason, for admins and moderators. Once while the report is open. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const listing = await findListing(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, exploreAbilities().readListing, listing)
	assertRateLimit(`report:${user.id}`, 10, 10 * 60_000, 'reports')
	const { reason } = await readValidatedBody(event, bodySchema)
	const report = await reportListing(db, { userId: user.id, listing: listing!, reason })
	return { id: report.id }
})
