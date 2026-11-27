import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db } from 'hub:db'
import { exploreAbilities } from '#shared/abilities/exploreAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { findPackage } from '#server/utils/explore/packages'

/** One of the member's packages, with the items it still has; another member's is not found. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	await authorize(event, exploreAbilities().useExplore)
	return await findPackage(db, user.id, getRouterParam(event, 'id', { decode: true }))
})
