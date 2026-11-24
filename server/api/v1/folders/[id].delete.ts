import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { db } from 'hub:db'
import { z } from 'zod'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { deleteFolder } from '#server/utils/chat/folders'

/** Deletes one of the member's folders. Its chats and folders move up to its parent; no chat is deleted. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const id = getRouterParam(event, 'id', { decode: true })
	if (!z.uuid().safeParse(id).success || !await deleteFolder(db, user.id, id!)) {
		throw createError({ status: 404, statusText: 'Folder not found' })
	}
	return { id }
})
