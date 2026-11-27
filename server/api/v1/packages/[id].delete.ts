import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db } from 'hub:db'
import { exploreAbilities } from '#shared/abilities/exploreAbilities'
import { authorize } from '#server/utils/core/authorize'
import { blob } from '#server/utils/core/blob'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { deletePackage } from '#server/utils/explore/packages'

/** Deletes one of the member's packages, and its listing when it was published. Copies people got stay theirs. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	await authorize(event, exploreAbilities().useExplore)
	const id = getRouterParam(event, 'id', { decode: true })
	await deletePackage(db, blob, user.id, id)
	return { id }
})
