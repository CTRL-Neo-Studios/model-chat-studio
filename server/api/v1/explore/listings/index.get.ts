import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { db } from 'hub:db'
import { exploreAbilities } from '#shared/abilities/exploreAbilities'
import { authorize } from '#server/utils/core/authorize'
import { browseListings, browseQuerySchema } from '#server/utils/explore/browse'

/** Explore's grid: `q`, `kind`, `category`, `tag`, `sort` (`newest`, `updated`, `gets`), `page`. Featured listings first. */
export default defineEventHandler(async (event) => {
	await authorize(event, exploreAbilities().useExplore)
	return await browseListings(db, await getValidatedQuery(event, browseQuerySchema))
})
