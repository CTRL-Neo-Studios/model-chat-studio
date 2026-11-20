import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db } from 'hub:db'
import { chatAbilities } from '#shared/abilities/chatAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { findChat, listChatMessages, listChatShares } from '#server/utils/chat/turns'

/** A chat with its messages, for the owner, the people it is shared with, and anyone when link access is on. */
export default defineEventHandler(async (event) => {
	const chat = await findChat(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, chatAbilities().readChat, chat)

	const { userId, sharedWith: _, ...view } = chat!
	const isOwner = (await useServerAuth().getUser(event))?.id === userId
	return {
		...view,
		isOwner,
		// Only the owner sees who else has access.
		sharedWith: isOwner ? await listChatShares(db, view.id) : [],
		messages: await listChatMessages(db, view.id),
	}
})
