import { defineEventHandler } from 'nuxt/server'
import { db } from 'hub:db'
import { exploreAbilities } from '#shared/abilities/exploreAbilities'
import { authorize } from '#server/utils/core/authorize'
import { getSetting } from '#server/utils/core/settings'

/** Explore's settings: whether members may publish, the categories and the size limit. Every member reads them. */
export default defineEventHandler(async (event) => {
	await authorize(event, exploreAbilities().useExplore)
	return await getSetting(db, 'explore')
})
