import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { db } from 'hub:db'
import { z } from 'zod'
import { requireChat } from '#server/utils/chat/access'
import { chatThread, showBranch } from '#server/utils/chat/turns'

const bodySchema = z.object({ messageId: z.string().min(1).max(100) }).strict()

/**
 * Owner and editors: shows the branch through one of the chat's user messages; the tip moves to its end, taking at each
 * step the branch made last. Returns the chat's thread as shown now.
 */
export default defineEventHandler(async (event) => {
	const chat = await requireChat(event, 'writeChat')
	const { messageId } = await readValidatedBody(event, bodySchema)
	await showBranch(db, chat.id, messageId)
	return await chatThread(db, chat.id, true)
})
