import { defineEventHandler } from 'nuxt/server'
import { db } from 'hub:db'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { requireChat } from '#server/utils/chat/access'
import { listAnswerVersions, listChatMessages, listChatShares } from '#server/utils/chat/turns'
import { listChatModels } from '#server/utils/chat/lanes'
import { chatLibraries } from '#server/utils/library/libraries'
import { shownThread } from '#server/utils/chat/thread'

/**
 * A chat with its lanes and messages, for the owner, the people it is shared with, and anyone when link access is on.
 * It names its libraries, each with the reader's `role` in it: `null` for someone who may not open it. The messages
 * are the branch shown (ending at the chat's tip), each answer the version shown; the owner also gets `versions`,
 * every version's id of the answers that have several.
 */
export default defineEventHandler(async (event) => {
	const { userId, sharedWith: _, ...view } = await requireChat(event, 'readChat')
	const reader = (await useServerAuth().getUser(event))?.id
	const isOwner = reader === userId
	const [sharedWith, models, messages, libraries, versions] = await Promise.all([
		// Only the owner sees who else has access.
		isOwner ? listChatShares(db, view.id) : [],
		listChatModels(db, view.id),
		listChatMessages(db, view.id),
		chatLibraries(db, view.id),
		isOwner ? listAnswerVersions(db, view.id) : {} as Record<string, string[]>,
	])
	const roleOf = (library: (typeof libraries)[number]) => !reader ? null : library.ownerId === reader ? 'owner' as const : library.members[reader] ?? null
	return { ...view, isOwner, sharedWith, models, messages: shownThread(messages, view.leafId), versions, libraries: libraries.map(library => ({ id: library.id, name: library.name, role: roleOf(library) })) }
})
