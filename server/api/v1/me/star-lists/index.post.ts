import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { db } from 'hub:db'
import { exploreAbilities } from '#shared/abilities/exploreAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { createList, starListSchema } from '#server/utils/explore/stars'

const bodySchema = starListSchema.partial({ description: true }).strict()

/** A new star list of the member's. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	await authorize(event, exploreAbilities().useExplore)
	const { name, description } = await readValidatedBody(event, bodySchema)
	return await createList(db, user.id, { name, description: description ?? '' })
})
