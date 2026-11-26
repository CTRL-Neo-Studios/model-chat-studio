import { createError, defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db } from 'hub:db'
import { z } from 'zod'
import { exploreAbilities } from '#shared/abilities/exploreAbilities'
import { listingTextsSchema } from '#shared/utils/package'
import { authorize } from '#server/utils/core/authorize'
import { getSetting } from '#server/utils/core/settings'
import { changeListing, findListing } from '#server/utils/explore/listings'

const bodySchema = listingTextsSchema.partial().extend({
	/** The publisher: `listed` or `unlisted`. Admins and moderators: `removed` with a `statusReason`, or `listed` to restore. */
	status: z.enum(['listed', 'unlisted', 'removed']).optional(),
	statusReason: z.string().trim().min(1).max(500).optional(),
	/** Admins and moderators: shown first on Explore. */
	featured: z.boolean().optional(),
}).strict()

/** Changes a listing: its publisher's texts and visibility, and the moderators' featuring, removal and restoring. */
export default defineEventHandler(async (event) => {
	const listing = await findListing(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, exploreAbilities().readListing, listing)
	const { status, statusReason, featured, ...texts } = await readValidatedBody(event, bodySchema)

	const restoring = listing!.status === 'removed' && status === 'listed'
	const moderating = featured !== undefined || status === 'removed' || restoring
	if (moderating) await authorize(event, exploreAbilities().moderateExplore)
	if (Object.keys(texts).length || (status && !moderating)) await authorize(event, exploreAbilities().editListing, listing)
	if (status === 'removed' && !statusReason) throw createError({ status: 400, statusText: 'Say why the listing is removed: its publisher sees the reason' })

	return await changeListing(db, listing!, {
		...texts,
		...(featured !== undefined && { featured }),
		...(status && { status, statusReason: status === 'removed' ? statusReason! : null }),
	}, await getSetting(db, 'explore'))
})
