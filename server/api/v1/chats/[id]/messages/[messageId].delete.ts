import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db } from 'hub:db'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { requireChat } from '#server/utils/chat/access'
import { deleteMessage } from '#server/utils/chat/turns'
import { deleteStoredFiles } from '#server/utils/chat/files'

/**
 * Owner only: deletes an answer version, or a user message with its answers. Returns the deleted ids and, when the
 * deleted answer was shown, the lane's version shown now.
 */
export default defineEventHandler(async (event) => {
	const chat = await requireChat(event, 'manageChat')
	const user = await useServerAuth().requireUser(event)

	const { ids, removedFileIds, shown } = await deleteMessage(db, chat.id, getRouterParam(event, 'messageId', { decode: true })!)
	await deleteStoredFiles(db, removedFileIds, user.id)
	return { ids, shown: shown ?? null }
})
