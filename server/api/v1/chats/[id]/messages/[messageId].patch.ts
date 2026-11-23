import { defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db } from 'hub:db'
import { z } from 'zod'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { requireChat } from '#server/utils/chat/access'
import { editMessage, showVersion } from '#server/utils/chat/turns'
import { deleteStoredFiles } from '#server/utils/chat/files'

const bodySchema = z.union([
	z.object({
		text: z.string().trim().min(1).max(100_000),
		/** User messages: also delete the answers and everything after, to answer the message again. */
		dropAfter: z.boolean().optional(),
	}).strict(),
	/** Answers: show this version in place of the lane's others. */
	z.object({ active: z.literal(true) }).strict(),
])

/** Owner only: replaces a message's text, or shows a version of an answer. Returns the message. */
export default defineEventHandler(async (event) => {
	const chat = await requireChat(event, 'manageChat')
	const user = await useServerAuth().requireUser(event)
	const body = await readValidatedBody(event, bodySchema)
	const messageId = getRouterParam(event, 'messageId', { decode: true })!

	if ('active' in body) return await showVersion(db, chat.id, messageId)
	const { message, removedFileIds } = await editMessage(db, chat.id, messageId, body)
	await deleteStoredFiles(db, removedFileIds, user.id)
	return message
})
