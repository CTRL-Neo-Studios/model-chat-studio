import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db } from 'hub:db'
import { exploreAbilities } from '#shared/abilities/exploreAbilities'
import { authorize } from '#server/utils/core/authorize'
import { blob } from '#server/utils/core/blob'
import { deleteListing, findListing } from '#server/utils/explore/listings'

/** Deletes a listing with its versions and their files: its publisher, admins and moderators. Copies members got stay. */
export default defineEventHandler(async (event) => {
	const listing = await findListing(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, exploreAbilities().deleteListing, listing)
	await deleteListing(db, blob, listing!.id)
	return { id: listing!.id }
})
