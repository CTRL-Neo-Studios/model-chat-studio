import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { db } from 'hub:db'
import { z } from 'zod'
import { exploreAbilities } from '#shared/abilities/exploreAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { unstarListing } from '#server/utils/explore/stars'

/** Takes the member's star away, and the listing out of their lists; also for a listing no longer shown. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	await authorize(event, exploreAbilities().useExplore)
	const id = getRouterParam(event, 'id', { decode: true })
	if (!z.uuid().safeParse(id).success) throw createError({ status: 404, statusText: 'Listing not found' })
	await unstarListing(db, user.id, id!)
	return { starred: false }
})
