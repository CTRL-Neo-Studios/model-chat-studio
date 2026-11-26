import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { db } from 'hub:db'
import { exploreAbilities } from '#shared/abilities/exploreAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { browseListings, browseQuerySchema } from '#server/utils/explore/browse'

/**
 * Explore's grid: `q`, `kind`, `category`, `tag`, `sort` (`newest`, `updated`, `gets`, `stars`), `page`. Featured
 * listings first; each card says whether the member starred it.
 */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	await authorize(event, exploreAbilities().useExplore)
	return await browseListings(db, await getValidatedQuery(event, browseQuerySchema), user.id)
})
