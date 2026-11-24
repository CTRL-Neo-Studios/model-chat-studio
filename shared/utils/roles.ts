import { createRoleChecker } from "#nuxt-cs-utils";
import type {User, UserRole} from "#shared/types/db";

export const { getRoleLevel, hasMinRole, hasRole, satisfies, isAuthenticated } = createRoleChecker<User, UserRole>({
	hierarchy: ['user', 'moderator', 'admin'] as const,
	getRole: (user) => user.role,
	// A ban with an expiry in the past is lifted. `banExpires` is a string once serialized to JSON.
	getBanned: (user) => !!user.banned && (!user.banExpires || new Date(user.banExpires) > new Date()),
	getAuthIndicator: (user) => !!user.id
})

/** Role actions only apply to someone of strictly lower role, which also excludes oneself. */
export function outranks(actor: Pick<User, 'role'>, target: Pick<User, 'role'>): boolean {
	return getRoleLevel(actor.role) > getRoleLevel(target.role)
}
