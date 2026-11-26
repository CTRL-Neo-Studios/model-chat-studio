import { defineAbility, deny } from "nuxt-authorization/utils";
import type {User} from "#shared/types/db";
import {satisfies} from "#shared/utils/roles";

/**
 * What access to a listing depends on. `ownerBanned`: its publisher is banned, which hides it while the ban lasts.
 * `published`: it has an approved version; a new listing waiting for review has none, and is hidden until it does.
 */
export interface ListingAccess {
	ownerId: string
	status: 'listed' | 'unlisted' | 'removed'
	ownerBanned?: boolean
	published?: boolean
}

// A listing someone may not see is reported as missing.
const notFound = () => deny({ statusCode: 404, message: 'Listing not found' })
const staff = (user: User) => satisfies(user, { minRole: 'moderator' })
const visible = (user: User, listing: ListingAccess) => (listing.status === 'listed' && listing.published !== false && !listing.ownerBanned) || listing.ownerId === user.id || staff(user)

/**
 * | | Publisher | Member | Moderator, admin |
 * |---|---|---|---|
 * | Browse and get | yes | yes | yes |
 * | Publish | open or reviewed mode | open or reviewed mode | always |
 * | See an unlisted, removed or not yet approved listing, or one whose publisher is banned | yes | no | yes |
 * | Texts, updates, listed or unlisted | yes, unless removed | no | their own |
 * | Delete | yes | no | yes |
 * | Review a publication | no | no | yes, not their own |
 * | Feature, remove, restore; Explore's settings | no | no | yes |
 * A banned member can do none of it.
 */
export function exploreAbilities() {
	return {
		/** Browsing Explore and getting from it. */
		useExplore: defineAbility((user: User) => {
			return satisfies(user)
		}),

		/** Publishing a listing or an update. */
		publish: defineAbility((user: User, settings: { publishing: 'open' | 'reviewed' | 'off' }) => {
			if (!satisfies(user)) return false
			if (settings.publishing !== 'off' || staff(user)) return true
			return deny({ statusCode: 403, message: 'Publishing to Explore is turned off on this instance' })
		}),

		/** Reading a listing: a listed and approved one, one's own, and any for admins and moderators. */
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

		/** Approving or rejecting a publication: admins and moderators, never their own. */
		review: defineAbility((user: User, listing?: ListingAccess) => {
			if (!satisfies(user, { minRole: 'moderator' })) return false
			if (!listing) return notFound()
			return listing.ownerId === user.id ? deny({ statusCode: 403, message: 'Nobody reviews their own publication' }) : true
		}),

		/** Featuring, removing and restoring listings, and Explore's settings. */
		moderateExplore: defineAbility((user: User) => {
			return satisfies(user, { minRole: 'moderator' })
		}),
	}
}
