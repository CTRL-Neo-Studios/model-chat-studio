import { defineEventHandler } from 'nuxt/server'
import { db } from 'hub:db'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { requireChat } from '#server/utils/chat/access'
import { chatThread, listChatShares } from '#server/utils/chat/turns'
import { listChatModels } from '#server/utils/chat/lanes'
import { chatLibraries } from '#server/utils/library/libraries'

/**
 * A chat with its lanes and messages, for the owner, the people it is shared with, and anyone when link access is on.
 * `role` is the reader's: `owner`, `editor`, `viewer`, or `null` for someone reading by link. It names its libraries,
 * each with the reader's `role` in it: `null` for someone who may not open it. The messages are the branch shown
 * (ending at the chat's tip), each answer the version shown; those who may write also get `versions` and `branches`,
 * to switch between them (`chatThread`).
 */
export default defineEventHandler(async (event) => {
	const { userId, sharedWith: shared, editors, ...view } = await requireChat(event, 'readChat')
	const reader = (await useServerAuth().getUser(event))?.id
	const role = !reader ? null : reader === userId ? 'owner' as const : editors.includes(reader) ? 'editor' as const : shared.includes(reader) ? 'viewer' as const : null
	const [sharedWith, models, thread, libraries] = await Promise.all([
		// Only the owner sees who else has access.
		role === 'owner' ? listChatShares(db, view.id) : [],
		listChatModels(db, view.id),
		chatThread(db, view.id, role === 'owner' || role === 'editor'),
		chatLibraries(db, view.id),
	])
	const roleOf = (library: (typeof libraries)[number]) => !reader ? null : library.ownerId === reader ? 'owner' as const : library.members[reader] ?? null
	return { ...view, role, sharedWith, models, ...thread, libraries: libraries.map(library => ({ id: library.id, name: library.name, role: roleOf(library) })) }
})
