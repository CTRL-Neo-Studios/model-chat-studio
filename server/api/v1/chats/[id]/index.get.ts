import { defineEventHandler } from 'nuxt/server'
import { db } from 'hub:db'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { requireChat } from '#server/utils/chat/access'
import { listChatMessages, listChatShares } from '#server/utils/chat/turns'
import { listChatModels } from '#server/utils/chat/lanes'

/** A chat with its lanes and messages, for the owner, the people it is shared with, and anyone when link access is on. */
export default defineEventHandler(async (event) => {
	const { userId, sharedWith: _, ...view } = await requireChat(event, 'readChat')
	const isOwner = (await useServerAuth().getUser(event))?.id === userId
	const [sharedWith, models, messages] = await Promise.all([
		// Only the owner sees who else has access.
		isOwner ? listChatShares(db, view.id) : [],
		listChatModels(db, view.id),
		listChatMessages(db, view.id),
	])
	return { ...view, isOwner, sharedWith, models, messages }
})
