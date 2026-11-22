import { defineAbility, deny } from "nuxt-authorization/utils";
import type {User} from "#shared/types/db";
import {satisfies} from "#shared/utils/roles";
import type {ProjectAccess} from "#shared/abilities/projectAbilities";

/**
 * What access to a chat depends on. `sharedWith` holds the ids of the people it is shared with; a project chat that is
 * `projectVisible` is also read by the project's owner and people.
 */
export interface ChatAccess {
	userId: string
	visibility: 'private' | 'public'
	sharedWith: string[]
	projectVisible?: boolean
	project?: ProjectAccess | null
}

// Anyone who may not read a chat is told it does not exist, admins included.
const notFound = () => deny({ statusCode: 404, message: 'Chat not found' })

const inProject = (user: User, project?: ProjectAccess | null) => !!project && (project.ownerId === user.id || !!project.members[user.id])

export function chatAbilities() {
	return {
		/** Own chats, creating chats, finding people to share with. */
		useChats: defineAbility((user: User) => {
			return satisfies(user)
		}),

		/**
		 * The owner, the people it is shared with, anyone with the link when link access is on, and, for a chat visible
		 * to its project, everyone in the project.
		 */
		readChat: defineAbility({ allowGuest: true }, (user: User | null, chat?: ChatAccess) => {
			if (user && !satisfies(user)) return false
			if (!chat) return notFound()
			if (chat.visibility === 'public' || (user && (chat.userId === user.id || chat.sharedWith.includes(user.id)))) return true
			if (user && chat.projectVisible && inProject(user, chat.project)) return true
			return notFound()
		}),

		/** Sending, editing, voting, renaming, sharing and deleting: the owner only. Shared access is read-only. */
		manageChat: defineAbility((user: User, chat?: ChatAccess) => {
			if (!satisfies(user)) return false
			return chat?.userId === user.id ? true : notFound()
		}),
	}
}
