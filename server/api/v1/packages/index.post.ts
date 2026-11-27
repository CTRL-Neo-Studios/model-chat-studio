import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { db } from 'hub:db'
import { z } from 'zod'
import { exploreAbilities } from '#shared/abilities/exploreAbilities'
import { listingTextsSchema } from '#shared/utils/package'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { createPackage } from '#server/utils/explore/packages'

const bodySchema = z.object({ name: listingTextsSchema.shape.name }).strict()

/** A new, empty Content Package. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	await authorize(event, exploreAbilities().useExplore)
	const { name } = await readValidatedBody(event, bodySchema)
	return await createPackage(db, user.id, name)
})
