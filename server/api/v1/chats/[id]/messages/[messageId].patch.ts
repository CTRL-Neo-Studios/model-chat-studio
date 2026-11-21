import { defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db } from 'hub:db'
import { z } from 'zod'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { requireChat } from '#server/utils/chat/access'
import { editMessage } from '#server/utils/chat/turns'
import { deleteStoredFiles } from '#server/utils/chat/files'

const bodySchema = z.object({
	text: z.string().trim().min(1).max(100_000),
	/** User messages: also delete the answers and everything after, to answer the message again. */
	dropAfter: z.boolean().optional(),
}).strict()

/** Owner only: replaces a message's text. */
export default defineEventHandler(async (event) => {
	const chat = await requireChat(event, 'manageChat')
	const user = await useServerAuth().requireUser(event)
	const edit = await readValidatedBody(event, bodySchema)

	const { message, removedFileIds } = await editMessage(db, chat.id, getRouterParam(event, 'messageId', { decode: true })!, edit)
	await deleteStoredFiles(db, removedFileIds, user.id)
	return message
})
