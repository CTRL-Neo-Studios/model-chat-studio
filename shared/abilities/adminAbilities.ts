import { defineAbility } from "nuxt-authorization/utils";
import type {User} from "#shared/types/db";
import {satisfies} from "#shared/utils/roles";

export function adminAbilities() {
	return {
		manageInvites: defineAbility((user: User) => {
			return satisfies(user, { minRole: 'admin' })
		}),
	}
}
