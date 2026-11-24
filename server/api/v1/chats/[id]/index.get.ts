import { defineEventHandler } from 'nuxt/server'
import { db } from 'hub:db'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { requireChat } from '#server/utils/chat/access'
import { chatThread, listChatShares } from '#server/utils/chat/turns'
import { listChatModels } from '#server/utils/chat/lanes'
import { chatLibraries } from '#server/utils/library/libraries'

/**
 * A chat with its lanes and messages, for the owner, the people it is shared with, and anyone when link access is on.
 * It names its libraries, each with the reader's `role` in it: `null` for someone who may not open it. The messages
 * are the branch shown (ending at the chat's tip), each answer the version shown; the owner also gets `versions` and
 * `branches`, to switch between them (`chatThread`).
 */
export default defineEventHandler(async (event) => {
	const { userId, sharedWith: _, ...view } = await requireChat(event, 'readChat')
	const reader = (await useServerAuth().getUser(event))?.id
	const isOwner = reader === userId
	const [sharedWith, models, thread, libraries] = await Promise.all([
		// Only the owner sees who else has access.
		isOwner ? listChatShares(db, view.id) : [],
		listChatModels(db, view.id),
		chatThread(db, view.id, isOwner),
		chatLibraries(db, view.id),
	])
	const roleOf = (library: (typeof libraries)[number]) => !reader ? null : library.ownerId === reader ? 'owner' as const : library.members[reader] ?? null
	return { ...view, isOwner, sharedWith, models, ...thread, libraries: libraries.map(library => ({ id: library.id, name: library.name, role: roleOf(library) })) }
})
