import { defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db } from 'hub:db'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { changeList, starListSchema } from '#server/utils/explore/stars'

const bodySchema = starListSchema.partial().strict()

/** Renames or describes one of the member's lists. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	return await changeList(db, user.id, getRouterParam(event, 'id', { decode: true }), await readValidatedBody(event, bodySchema))
})
