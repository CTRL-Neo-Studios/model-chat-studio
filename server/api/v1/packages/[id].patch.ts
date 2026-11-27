import { defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db } from 'hub:db'
import { z } from 'zod'
import { exploreAbilities } from '#shared/abilities/exploreAbilities'
import { folderDefaultsSchema } from '#shared/utils/folderDefaults'
import { listingTextsSchema, packageItemsSchema, packageTextsSchema } from '#shared/utils/package'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { changePackage } from '#server/utils/explore/packages'

const bodySchema = z.object({
	name: listingTextsSchema.shape.name,
	items: packageItemsSchema,
	/** The chat the package starts, as a folder's defaults; `null`: none. */
	setup: folderDefaultsSchema.nullable(),
	texts: packageTextsSchema,
}).partial().strict()

/** Changes one of the member's packages; every item in it must be theirs. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	await authorize(event, exploreAbilities().useExplore)
	return await changePackage(db, user.id, getRouterParam(event, 'id', { decode: true }), await readValidatedBody(event, bodySchema))
})
