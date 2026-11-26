import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { db } from 'hub:db'
import { z } from 'zod'
import { exploreAbilities } from '#shared/abilities/exploreAbilities'
import { packageSourceSchema } from '#shared/utils/package'
import { authorize } from '#server/utils/core/authorize'
import { getSetting } from '#server/utils/core/settings'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { previewListing } from '#server/utils/explore/listings'

const bodySchema = z.object({ source: packageSourceSchema }).strict()

/** What publishing these items would hold and leave out, for the publish dialog. Nothing is stored. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	await authorize(event, exploreAbilities().useExplore)
	const { source } = await readValidatedBody(event, bodySchema)
	return await previewListing(db, user.id, source, await getSetting(db, 'explore'))
})
