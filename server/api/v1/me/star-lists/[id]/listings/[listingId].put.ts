import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db } from 'hub:db'
import { exploreAbilities } from '#shared/abilities/exploreAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { findListing } from '#server/utils/explore/listings'
import { addToList } from '#server/utils/explore/stars'

/** Puts a listing the member can see in one of their lists, which stars it. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const listing = await findListing(db, getRouterParam(event, 'listingId', { decode: true }))
	await authorize(event, exploreAbilities().readListing, listing)
	await addToList(db, user.id, getRouterParam(event, 'id', { decode: true }), listing!.id)
	return { listed: true }
})
