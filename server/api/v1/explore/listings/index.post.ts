import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { db } from 'hub:db'
import { exploreAbilities } from '#shared/abilities/exploreAbilities'
import { listingTextsSchema, packageSourceSchema } from '#shared/utils/package'
import { authorize } from '#server/utils/core/authorize'
import { assertRateLimit } from '#server/utils/core/rateLimit'
import { getSetting } from '#server/utils/core/settings'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { blob } from '#server/utils/core/blob'
import { publishListing } from '#server/utils/explore/listings'

const bodySchema = listingTextsSchema.extend({ source: packageSourceSchema }).strict()

/** Publishes the member's items (or a folder's setup, as a pack) to Explore as a new listing (milestone 13 plan, section 4). */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const settings = await getSetting(db, 'explore')
	await authorize(event, exploreAbilities().publish, settings)
	assertRateLimit(`publish:${user.id}`, 10, 10 * 60_000, 'publications')
	const { source, ...texts } = await readValidatedBody(event, bodySchema)
	return await publishListing(db, blob, { userId: user.id, texts, source, settings })
})
