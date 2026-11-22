import { defineEventHandler } from 'nuxt/server'
import { db } from 'hub:db'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { requireChat } from '#server/utils/chat/access'
import { listChatMessages, listChatShares } from '#server/utils/chat/turns'
import { listChatModels } from '#server/utils/chat/lanes'

/**
 * A chat with its lanes and messages, for the owner, the people it is shared with, anyone when link access is on, and
 * the project's people when it is visible to the project. A project chat names its project for the badge; `inProject`
 * says whether the reader may open it, since someone reading by link or share alone may not.
 */
export default defineEventHandler(async (event) => {
	const { userId, sharedWith: _, project, ...view } = await requireChat(event, 'readChat')
	const reader = (await useServerAuth().getUser(event))?.id
	const isOwner = reader === userId
	const [sharedWith, models, messages] = await Promise.all([
		// Only the owner sees who else has access.
		isOwner ? listChatShares(db, view.id) : [],
		listChatModels(db, view.id),
		listChatMessages(db, view.id),
	])
	const inProject = !!project && !!reader && (project.ownerId === reader || !!project.members[reader])
	return { ...view, isOwner, sharedWith, models, messages, project: project && { id: project.id, name: project.name, inProject } }
})
