import { defineAbility } from "nuxt-authorization/utils";
import type {User, UserRole} from "#shared/types/db";
import {outranks, satisfies} from "#shared/utils/roles";

export function userAbilities() {
	return {
		listUsers: defineAbility((user: User) => {
			return satisfies(user, { minRole: 'moderator' })
		}),

		getUser: defineAbility((user: User) => {
			return satisfies(user)
		}),

		// Admin only. Profile fields come from GitHub at login; only role and budget are editable.
		// Changing a role follows the role-action rule; setting a budget does not.
		editUser: defineAbility((user: User, targetUser?: User, newRole?: UserRole) => {
			if (!targetUser || !satisfies(user, { minRole: 'admin' })) return false;
			return newRole === undefined || outranks(user, targetUser)
		}),

		deleteUser: defineAbility((user: User, targetUser?: User) => {
			if (!targetUser) return false;
			return satisfies(user, { minRole: 'admin' }) && outranks(user, targetUser)
		}),

		promoteUser: defineAbility((user: User, targetUser?: User) => {
			if (!targetUser) return false;
			return satisfies(user, { minRole: 'admin' }) && targetUser.role === 'user'
		}),

		demoteUser: defineAbility((user: User, targetUser?: User) => {
			if (!targetUser) return false;
			return satisfies(user, { minRole: 'admin' }) && targetUser.role === 'moderator'
		}),

		banUser: defineAbility((user: User, targetUser?: User) => {
			if (!targetUser) return false;
			return satisfies(user, { minRole: 'moderator' }) && outranks(user, targetUser)
		}),

		unbanUser: defineAbility((user: User, targetUser?: User) => {
			if (!targetUser) return false;
			return satisfies(user, { minRole: 'moderator' }) && outranks(user, targetUser)
		})
	}
}
