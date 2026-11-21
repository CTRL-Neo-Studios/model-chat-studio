import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db } from 'hub:db'
import { chatAbilities } from '#shared/abilities/chatAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { deleteMessage, findChat } from '#server/utils/chat/turns'
import { deleteStoredFiles } from '#server/utils/chat/files'
import { useInference } from '#server/utils/inference'

/** Owner only: deletes an answer, or a user message with its answers. Returns the deleted ids. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const chat = await findChat(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, chatAbilities().manageChat, chat)

	const { ids, removedFileIds } = await deleteMessage(db, chat!.id, getRouterParam(event, 'messageId', { decode: true })!)
	await deleteStoredFiles(db, removedFileIds, await useInference(db, user.id))
	return { ids }
})
