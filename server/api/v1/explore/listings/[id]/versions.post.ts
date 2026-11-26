import { defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db } from 'hub:db'
import { z } from 'zod'
import { exploreAbilities } from '#shared/abilities/exploreAbilities'
import { packageSourceSchema } from '#shared/utils/package'
import { authorize } from '#server/utils/core/authorize'
import { assertRateLimit } from '#server/utils/core/rateLimit'
import { getSetting } from '#server/utils/core/settings'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { blob } from '#server/utils/core/blob'
import { findListing, publishUpdate } from '#server/utils/explore/listings'

const bodySchema = z.object({
	/** What changed, shown with the version. */
	notes: z.string().trim().min(1).max(2000),
	/** Absent: the items the listing was last taken from. */
	source: packageSourceSchema.optional(),
}).strict()

/** "Publish an update": the publisher's listing gets a new version. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const listing = await findListing(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, exploreAbilities().editListing, listing)
	const settings = await getSetting(db, 'explore')
	await authorize(event, exploreAbilities().publish, settings)
	assertRateLimit(`publish:${user.id}`, 10, 10 * 60_000, 'publications')
	const { notes, source } = await readValidatedBody(event, bodySchema)
	return await publishUpdate(db, blob, { listing: listing!, notes, source, settings })
})
