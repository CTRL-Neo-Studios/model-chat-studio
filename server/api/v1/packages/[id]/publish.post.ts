import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db } from 'hub:db'
import { exploreAbilities } from '#shared/abilities/exploreAbilities'
import { authorize } from '#server/utils/core/authorize'
import { blob } from '#server/utils/core/blob'
import { assertRateLimit } from '#server/utils/core/rateLimit'
import { getSetting } from '#server/utils/core/settings'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { publishPackage } from '#server/utils/explore/packages'

/** Publishes one of the member's draft packages to Explore, as publishing anything else (the mode, review, the limits). */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const settings = await getSetting(db, 'explore')
	await authorize(event, exploreAbilities().publish, settings)
	assertRateLimit(`publish:${user.id}`, 10, 10 * 60_000, 'publications')
	return await publishPackage(db, blob, { userId: user.id, packageId: getRouterParam(event, 'id', { decode: true }), settings })
})
