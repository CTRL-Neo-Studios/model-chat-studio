import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db } from 'hub:db'
import { exploreAbilities } from '#shared/abilities/exploreAbilities'
import { authorize } from '#server/utils/core/authorize'
import { assertRateLimit } from '#server/utils/core/rateLimit'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { blob } from '#server/utils/core/blob'
import { findListing } from '#server/utils/explore/listings'
import { getListing } from '#server/utils/explore/browse'

/** "Get": the member's own copies of the listing's current version. Returns the ids made and the version. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const listing = await findListing(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, exploreAbilities().readListing, listing)
	assertRateLimit(`get:${user.id}`, 20, 10 * 60_000, 'gets')
	return await getListing(db, blob, listing!, user.id)
})
