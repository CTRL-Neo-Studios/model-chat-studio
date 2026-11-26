import { defineAbility, deny } from "nuxt-authorization/utils";
import type {User} from "#shared/types/db";
import {satisfies} from "#shared/utils/roles";

/** What access to a listing depends on. */
export interface ListingAccess {
	ownerId: string
	status: 'listed' | 'unlisted' | 'removed'
}

// A listing someone may not see is reported as missing.
const notFound = () => deny({ statusCode: 404, message: 'Listing not found' })
const staff = (user: User) => satisfies(user, { minRole: 'moderator' })
const visible = (user: User, listing: ListingAccess) => listing.status === 'listed' || listing.ownerId === user.id || staff(user)

/**
 * | | Publisher | Member | Moderator, admin |
 * |---|---|---|---|
 * | Browse and get | yes | yes | yes |
 * | Publish | while publishing is on | while publishing is on | always |
 * | See an unlisted or removed listing | yes | no | yes |
 * | Texts, updates, listed or unlisted | yes, unless removed | no | their own |
 * | Delete | yes | no | yes |
 * | Feature, remove, restore; Explore's settings | no | no | yes |
 * A banned member can do none of it.
 */
export function exploreAbilities() {
	return {
		/** Browsing Explore and getting from it. */
		useExplore: defineAbility((user: User) => {
			return satisfies(user)
		}),

		/** Publishing a listing. */
		publish: defineAbility((user: User, settings: { publishing: boolean }) => {
			if (!satisfies(user)) return false
			if (settings.publishing || staff(user)) return true
			return deny({ statusCode: 403, message: 'Publishing to Explore is turned off on this instance' })
		}),

		/** Reading a listing: a listed one, one's own, and any for admins and moderators. */
		readListing: defineAbility((user: User, listing?: ListingAccess) => {
			if (!satisfies(user)) return false
			if (!listing) return notFound()
			return visible(user, listing) ? true : notFound()
		}),

		/** The publisher's changes: texts, a new version, listed or unlisted. Not once removed. */
		editListing: defineAbility((user: User, listing?: ListingAccess) => {
			if (!satisfies(user)) return false
			if (!listing || !visible(user, listing)) return notFound()
			if (listing.ownerId !== user.id) return deny({ statusCode: 403, message: 'Only its publisher can change this listing' })
			return listing.status === 'removed' ? deny({ statusCode: 403, message: 'This listing was removed by a moderator' }) : true
		}),

		/** Deleting: the publisher, admins and moderators. */
		deleteListing: defineAbility((user: User, listing?: ListingAccess) => {
			if (!satisfies(user)) return false
			if (!listing || !visible(user, listing)) return notFound()
			return listing.ownerId === user.id || staff(user) ? true : deny({ statusCode: 403, message: 'Only its publisher can delete this listing' })
		}),

		/** Featuring, removing and restoring listings, and Explore's settings. */
		moderateExplore: defineAbility((user: User) => {
			return satisfies(user, { minRole: 'moderator' })
		}),
	}
}
