import { defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db } from 'hub:db'
import { z } from 'zod'
import { exploreAbilities } from '#shared/abilities/exploreAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { findVersionListing, reviewVersion } from '#server/utils/explore/reviews'

const bodySchema = z.union([
	z.object({ approve: z.literal(true) }).strict(),
	z.object({ reject: z.literal(true), reason: z.string().trim().min(1).max(500) }).strict(),
])

/** Admins and moderators, never on their own publication: approve a version waiting for review, or reject it with a reason. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const versionId = getRouterParam(event, 'id', { decode: true })
	const listing = await findVersionListing(db, versionId)
	await authorize(event, exploreAbilities().review, listing)
	await reviewVersion(db, { versionId: versionId!, reviewerId: user.id, decision: await readValidatedBody(event, bodySchema) })
	return { id: versionId }
})
