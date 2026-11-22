import { defineAbility, deny } from "nuxt-authorization/utils";
import type {User} from "#shared/types/db";
import {satisfies} from "#shared/utils/roles";

export type ProjectRole = 'viewer' | 'member' | 'editor'

/** What access to a project depends on. `members` maps the people it is shared with to their role. */
export interface ProjectAccess {
	ownerId: string
	members: Record<string, ProjectRole>
}

// Anyone who is not in a project is told it does not exist; someone in it without the right is told so.
const notFound = () => deny({ statusCode: 404, message: 'Project not found' })
const LEVEL: Record<ProjectRole | 'owner', number> = { viewer: 1, member: 2, editor: 3, owner: 4 }

/** The owner, or someone whose role reaches `need`. */
const atLeast = (need: ProjectRole | 'owner', refusal: string) => (user: User, project?: ProjectAccess) => {
	if (!satisfies(user)) return false
	if (!project) return notFound()
	const role = project.ownerId === user.id ? 'owner' : project.members[user.id]
	if (!role) return notFound()
	return LEVEL[role] >= LEVEL[need] ? true : deny({ statusCode: 403, message: refusal })
}

/**
 * | | Owner | Editor | Member | Viewer |
 * |---|---|---|---|---|
 * | Read the file space and project-visible chats | yes | yes | yes | yes |
 * | Start chats in the project | yes | yes | yes | no |
 * | Add, edit, tag, move and delete files | yes | yes | no | no |
 * | People, default context profile, rename, delete | yes | no | no | no |
 */
export function projectAbilities() {
	return {
		/** Listing and creating projects. */
		useProjects: defineAbility((user: User) => {
			return satisfies(user)
		}),

		/** Reading the file space and the project-visible chats. */
		readProject: defineAbility(atLeast('viewer', 'You cannot read this project')),

		/** Starting chats in the project, and keeping folders for them. */
		startChats: defineAbility(atLeast('member', 'Viewers cannot start chats in this project')),

		/** Adding, editing, tagging, moving and deleting files, notes and folders. */
		editFiles: defineAbility(atLeast('editor', 'Only editors can change the project\'s files')),

		/** People and roles, the default context profile, renaming and deleting the project. */
		manageProject: defineAbility(atLeast('owner', 'Only the owner can change this')),
	}
}
