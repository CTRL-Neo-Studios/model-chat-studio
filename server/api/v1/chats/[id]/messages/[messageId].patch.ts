import { defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db } from 'hub:db'
import { z } from 'zod'
import { requireChat } from '#server/utils/chat/access'
import { branchMessage, editMessage, showVersion } from '#server/utils/chat/turns'

const bodySchema = z.union([
	z.object({
		text: z.string().trim().min(1).max(100_000),
		/** User messages, "Save and resend": a new branch at the message's place with this text, shown; the earlier one stays. */
		branch: z.boolean().optional(),
	}).strict(),
	/** Answers: show this version in place of the lane's others. */
	z.object({ active: z.literal(true) }).strict(),
])

/** Owner only: replaces a message's text, starts a branch from it, or shows a version of an answer. Returns the message. */
export default defineEventHandler(async (event) => {
	const chat = await requireChat(event, 'manageChat')
	const body = await readValidatedBody(event, bodySchema)
	const messageId = getRouterParam(event, 'messageId', { decode: true })!

	if ('active' in body) return await showVersion(db, chat.id, messageId)
	if (body.branch) return await branchMessage(db, chat.id, messageId, body.text)
	return await editMessage(db, chat.id, messageId, body.text)
})
