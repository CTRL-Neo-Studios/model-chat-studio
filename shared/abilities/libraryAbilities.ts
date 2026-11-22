import { defineAbility, deny } from "nuxt-authorization/utils";
import type {User} from "#shared/types/db";
import {satisfies} from "#shared/utils/roles";

export type LibraryRole = 'viewer' | 'editor'

/** What access to a library depends on. `members` maps the people it is shared with to their role. */
export interface LibraryAccess {
	ownerId: string
	members: Record<string, LibraryRole>
}

// Anyone without access is told the library does not exist; someone with access but not the right is told so.
const notFound = () => deny({ statusCode: 404, message: 'Library not found' })
const LEVEL: Record<LibraryRole | 'owner', number> = { viewer: 1, editor: 2, owner: 3 }

/** The owner, or someone whose role reaches `need`. */
const atLeast = (need: LibraryRole | 'owner', refusal: string) => (user: User, library?: LibraryAccess) => {
	if (!satisfies(user)) return false
	if (!library) return notFound()
	const role = library.ownerId === user.id ? 'owner' : library.members[user.id]
	if (!role) return notFound()
	return LEVEL[role] >= LEVEL[need] ? true : deny({ statusCode: 403, message: refusal })
}

/**
 * | | Owner | Editor | Viewer |
 * |---|---|---|---|
 * | Read the files; attach the library to own chats | yes | yes | yes |
 * | Add, edit, tag, move and delete files | yes | yes | no |
 * | People, rename, delete | yes | no | no |
 */
export function libraryAbilities() {
	return {
		/** Listing and creating libraries. */
		useLibraries: defineAbility((user: User) => {
			return satisfies(user)
		}),

		/** Reading the files, and attaching the library to one's own chats. */
		readLibrary: defineAbility(atLeast('viewer', 'You cannot read this library')),

		/** Adding, editing, tagging, moving and deleting files, notes and folders. */
		editFiles: defineAbility(atLeast('editor', 'Only editors can change the library\'s files')),

		/** People and roles, renaming and deleting the library. */
		manageLibrary: defineAbility(atLeast('owner', 'Only the owner can change this')),
	}
}
