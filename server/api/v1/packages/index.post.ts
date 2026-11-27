import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { db } from 'hub:db'
import { z } from 'zod'
import { exploreAbilities } from '#shared/abilities/exploreAbilities'
import { listingTextsSchema } from '#shared/utils/package'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { createPackage, packageFromFolder } from '#server/utils/explore/packages'

const bodySchema = z.union([z.object({ name: listingTextsSchema.shape.name }).strict(), z.object({ fromFolderId: z.uuid() }).strict()])

/** A new Content Package: empty and named, or made from one of the member's folders with a setup. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	await authorize(event, exploreAbilities().useExplore)
	const body = await readValidatedBody(event, bodySchema)
	return 'fromFolderId' in body ? await packageFromFolder(db, user.id, body.fromFolderId) : await createPackage(db, user.id, body.name)
})
