import { defineAbility, deny } from "nuxt-authorization/utils";
import type {User} from "#shared/types/db";
import {satisfies} from "#shared/utils/roles";

/** What access to a chat depends on. `sharedWith` holds the ids of the people it is shared with. */
export interface ChatAccess {
	userId: string
	visibility: 'private' | 'public'
	sharedWith: string[]
}

// Anyone who may not read a chat is told it does not exist, admins included.
const notFound = () => deny({ statusCode: 404, message: 'Chat not found' })

export function chatAbilities() {
	return {
		/** Own chats, creating chats, finding people to share with. */
		useChats: defineAbility((user: User) => {
			return satisfies(user)
		}),

		/** The owner, the people it is shared with, and anyone with the link when link access is on. */
		readChat: defineAbility({ allowGuest: true }, (user: User | null, chat?: ChatAccess) => {
			if (user && !satisfies(user)) return false
			if (!chat) return notFound()
			if (chat.visibility === 'public' || (user && (chat.userId === user.id || chat.sharedWith.includes(user.id)))) return true
			return notFound()
		}),

		/** Sending, editing, voting, renaming, sharing and deleting: the owner only. Shared access is read-only. */
		manageChat: defineAbility((user: User, chat?: ChatAccess) => {
			if (!satisfies(user)) return false
			return chat?.userId === user.id ? true : notFound()
		}),
	}
}
