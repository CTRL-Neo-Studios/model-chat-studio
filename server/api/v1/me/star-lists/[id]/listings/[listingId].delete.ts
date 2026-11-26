import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { db } from 'hub:db'
import { z } from 'zod'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { removeFromList } from '#server/utils/explore/stars'

/** Takes a listing out of one of the member's lists; it stays starred. Also for a listing no longer shown. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const listingId = getRouterParam(event, 'listingId', { decode: true })
	if (!z.uuid().safeParse(listingId).success) throw createError({ status: 404, statusText: 'Listing not found' })
	await removeFromList(db, user.id, getRouterParam(event, 'id', { decode: true }), listingId!)
	return { listed: false }
})
