import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db } from 'hub:db'
import { exploreAbilities } from '#shared/abilities/exploreAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { findListing } from '#server/utils/explore/listings'
import { starListing } from '#server/utils/explore/stars'

/** Stars a listing the member can see; starring it again changes nothing. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const listing = await findListing(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, exploreAbilities().readListing, listing)
	await starListing(db, user.id, listing!.id)
	return { starred: true }
})
