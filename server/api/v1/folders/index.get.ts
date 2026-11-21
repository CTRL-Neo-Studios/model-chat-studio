import { defineEventHandler } from 'nuxt/server'
import { db } from 'hub:db'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { listFolders } from '#server/utils/chat/folders'

/** The member's folders, by name; `parentId` builds the tree. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	return await listFolders(db, user.id)
})
