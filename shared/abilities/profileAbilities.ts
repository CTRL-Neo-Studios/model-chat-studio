import { defineAbility, deny } from "nuxt-authorization/utils";
import type {User} from "#shared/types/db";
import {satisfies} from "#shared/utils/roles";

/** What access to a model profile depends on. `ownerId` `null` is an instance profile. */
export interface ProfileAccess {
	ownerId: string | null
}

// Someone else's personal profile is reported as missing.
const notFound = () => deny({ statusCode: 404, message: 'Profile not found' })

export function profileAbilities() {
	return {
		/** Listing, creating own profiles, and starting lanes from them. */
		useProfiles: defineAbility((user: User) => {
			return satisfies(user)
		}),

		/** One's own profiles and the instance profiles. */
		readProfile: defineAbility((user: User, profile?: ProfileAccess) => {
			if (!satisfies(user)) return false
			if (!profile) return notFound()
			return profile.ownerId === null || profile.ownerId === user.id ? true : notFound()
		}),

		/** Changing or deleting: the owner; instance profiles, admins only. */
		manageProfile: defineAbility((user: User, profile?: ProfileAccess) => {
			if (!satisfies(user)) return false
			if (!profile) return notFound()
			if (profile.ownerId === null) return satisfies(user, { minRole: 'admin' })
			return profile.ownerId === user.id ? true : notFound()
		}),

		/** Publishing instance profiles. */
		publishProfiles: defineAbility((user: User) => {
			return satisfies(user, { minRole: 'admin' })
		}),
	}
}
