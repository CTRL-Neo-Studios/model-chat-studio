import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db } from 'hub:db'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { deleteList } from '#server/utils/explore/stars'

/** Deletes one of the member's lists; its listings stay starred. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const id = getRouterParam(event, 'id', { decode: true })
	await deleteList(db, user.id, id)
	return { id }
})
