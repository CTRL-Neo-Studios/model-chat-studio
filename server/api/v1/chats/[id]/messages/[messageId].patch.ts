import { defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db } from 'hub:db'
import { z } from 'zod'
import { chatAbilities } from '#shared/abilities/chatAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { editMessage, findChat } from '#server/utils/chat/turns'
import { deleteStoredFiles } from '#server/utils/chat/files'
import { useInference } from '#server/utils/inference'

const bodySchema = z.object({
	text: z.string().trim().min(1).max(100_000),
	/** User messages: also delete the answers and everything after, to answer the message again. */
	dropAfter: z.boolean().optional(),
}).strict()

/** Owner only: replaces a message's text. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const chat = await findChat(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, chatAbilities().manageChat, chat)
	const edit = await readValidatedBody(event, bodySchema)

	const { message, removedFileIds } = await editMessage(db, chat!.id, getRouterParam(event, 'messageId', { decode: true })!, edit)
	await deleteStoredFiles(db, removedFileIds, await useInference(db, user.id))
	return message
})
