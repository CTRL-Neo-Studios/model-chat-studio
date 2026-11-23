import { defineEventHandler, getQuery, getRouterParam } from 'nuxt/server'
import { db } from 'hub:db'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { requireChat } from '#server/utils/chat/access'
import { chatThread, deleteMessage } from '#server/utils/chat/turns'
import { deleteStoredFiles } from '#server/utils/chat/files'

/**
 * Owner only: deletes an answer version (the lane's newest one left is shown), or a user message with its answers;
 * with `?branch=true`, a user message with everything after it on its branch. Returns the deleted ids and the chat's
 * thread as shown now.
 */
export default defineEventHandler(async (event) => {
	const chat = await requireChat(event, 'manageChat')
	const user = await useServerAuth().requireUser(event)

	const { ids, removedFileIds } = await deleteMessage(db, chat.id, getRouterParam(event, 'messageId', { decode: true })!, getQuery(event).branch === 'true')
	await deleteStoredFiles(db, removedFileIds, user.id)
	return { ids, thread: await chatThread(db, chat.id, true) }
})
