import { defineAbility, deny } from "nuxt-authorization/utils";
import type {User} from "#shared/types/db";
import {satisfies} from "#shared/utils/roles";

/** What access to a project depends on. */
export interface ProjectAccess {
	ownerId: string
}

// Anyone who may not read a project is told it does not exist.
const notFound = () => deny({ statusCode: 404, message: 'Project not found' })

// The owner only, until sharing (phase 4.6) adds people with roles. Each route already asks for the right it needs.
const isOwner = (user: User, project?: ProjectAccess) => {
	if (!satisfies(user)) return false
	return project?.ownerId === user.id ? true : notFound()
}

export function projectAbilities() {
	return {
		/** Listing and creating one's own projects. */
		useProjects: defineAbility((user: User) => {
			return satisfies(user)
		}),

		/** Reading the file space. */
		readProject: defineAbility(isOwner),

		/** Adding, editing, tagging, moving and deleting files, notes and folders. */
		editFiles: defineAbility(isOwner),

		/** Renaming and deleting the project. */
		manageProject: defineAbility(isOwner),
	}
}
