import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { db } from 'hub:db'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { folderStart } from '#server/utils/chat/folderStart'
import { newLaneValues } from '#server/utils/chat/lanes'

/**
 * What a new chat started in one of the member's folders begins with: the folder's defaults, or the nearest folder's
 * up the tree, as the member may still use them. Lanes come as the values they start with, for the new-chat screen.
 */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const start = await folderStart(db, user, getRouterParam(event, 'id', { decode: true }) ?? '')
	if (!start) throw createError({ status: 404, statusText: 'Folder not found' })
	const lanes = start.defaults?.models && await Promise.all(start.defaults.models.map(lane => newLaneValues(db, user.id, lane)))
	return { ...start, lanes: lanes ?? null }
})
