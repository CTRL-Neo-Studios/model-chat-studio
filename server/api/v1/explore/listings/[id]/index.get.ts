import { defineEventHandler, getQuery, getRouterParam } from 'nuxt/server'
import { db } from 'hub:db'
import { exploreAbilities } from '#shared/abilities/exploreAbilities'
import { satisfies } from '#shared/utils/roles'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { findListing } from '#server/utils/explore/listings'
import { listingPage } from '#server/utils/explore/browse'

/**
 * A listing's page: everything in its current version, its versions, its publisher, and whether the member has it.
 * `?version=` shows another version to its publisher and to admins and moderators: a review reads it here.
 */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const listing = await findListing(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, exploreAbilities().readListing, listing)
	const version = getQuery(event).version
	return await listingPage(db, listing!, { id: user.id, staff: satisfies(user, { minRole: 'moderator' }) }, typeof version === 'string' ? version : undefined)
})
