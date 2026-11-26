import { defineAbility, deny } from "nuxt-authorization/utils";
import type {User} from "#shared/types/db";
import {satisfies} from "#shared/utils/roles";

/** What access to a chat depends on. `sharedWith` holds the ids of the people it is shared with, `editors` those of them who may write. */
export interface ChatAccess {
	userId: string
	visibility: 'private' | 'public'
	sharedWith: string[]
	editors: string[]
}

// Anyone who may not read a chat is told it does not exist, admins included.
const notFound = () => deny({ statusCode: 404, message: 'Chat not found' })
const reads = (user: User | null, chat: ChatAccess) => chat.visibility === 'public' || (!!user && (chat.userId === user.id || chat.sharedWith.includes(user.id)))

export function chatAbilities() {
	return {
		/** Own chats, creating chats, finding people to share with. */
		useChats: defineAbility((user: User) => {
			return satisfies(user)
		}),

		/** The owner, the people it is shared with, and anyone with the link when link access is on. */
		readChat: defineAbility({ allowGuest: true }, (user: User | null, chat?: ChatAccess) => {
			if (user && !satisfies(user)) return false
			return chat && reads(user, chat) ? true : notFound()
		}),

		/**
		 * Taking part (milestone 11): sending, uploads, edits and deletions of messages, votes, switching branches and
		 * versions, `/compact`. The owner and the editors; a reader is told no, a stranger that it does not exist.
		 */
		writeChat: defineAbility((user: User, chat?: ChatAccess) => {
			if (!satisfies(user)) return false
			if (!chat || !reads(user, chat)) return notFound()
			return chat.userId === user.id || chat.editors.includes(user.id)
		}),

		/** Renaming, sharing, the models, libraries and settings, moving, keeping and deleting: the owner only. */
		manageChat: defineAbility((user: User, chat?: ChatAccess) => {
			if (!satisfies(user)) return false
			if (!chat || !reads(user, chat)) return notFound()
			return chat.userId === user.id
		}),
	}
}
