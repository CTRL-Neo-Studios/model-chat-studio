import { expect, test } from 'bun:test'
import { allows, authorize } from 'nuxt-authorization/utils'
import { exploreAbilities, type ListingAccess } from '../shared/abilities/exploreAbilities'
import type { User } from '../shared/types/db'

const person = (id: string, role = 'user', banned = false) => ({ id, role, banned, banExpires: null }) as User
const people = {
	publisher: person('publisher'),
	member: person('member'),
	moderator: person('moderator', 'moderator'),
	admin: person('admin', 'admin'),
	banned: person('publisher', 'user', true),
}
const can = exploreAbilities()
const listing = (status: ListingAccess['status']): ListingAccess => ({ ownerId: 'publisher', status })

// The access table of the plan (milestone 13, sections 1 and 4), row by row: publisher, member, moderator, admin, and
// the publisher banned.
test('each role can do what the access table says, and no more', async () => {
	const rows: Record<string, [(user: User) => Promise<boolean>, boolean[]]> = {
		'publish, publishing on': [user => allows(can.publish, user, { publishing: true }), [true, true, true, true, false]],
		'publish, publishing off': [user => allows(can.publish, user, { publishing: false }), [false, false, true, true, false]],
		'read a listed listing': [user => allows(can.readListing, user, listing('listed')), [true, true, true, true, false]],
		'read an unlisted listing': [user => allows(can.readListing, user, listing('unlisted')), [true, false, true, true, false]],
		'read a removed listing': [user => allows(can.readListing, user, listing('removed')), [true, false, true, true, false]],
		'edit a listed listing': [user => allows(can.editListing, user, listing('listed')), [true, false, false, false, false]],
		'edit an unlisted listing': [user => allows(can.editListing, user, listing('unlisted')), [true, false, false, false, false]],
		'edit a removed listing': [user => allows(can.editListing, user, listing('removed')), [false, false, false, false, false]],
		'delete a listed listing': [user => allows(can.deleteListing, user, listing('listed')), [true, false, true, true, false]],
		'delete a removed listing': [user => allows(can.deleteListing, user, listing('removed')), [true, false, true, true, false]],
		'feature, remove, restore; settings': [user => allows(can.moderateExplore, user), [false, false, true, true, false]],
		'browse and get': [user => allows(can.useExplore, user), [true, true, true, true, false]],
	}
	for (const [row, [check, expected]] of Object.entries(rows)) {
		const got = await Promise.all(Object.values(people).map(check))
		expect({ row, got }).toEqual({ row, got: expected })
	}
})

test('refusals say why, and hide what someone may not see', async () => {
	const refusal = (run: Promise<unknown>) => run.then(() => 'allowed', (error: { statusCode: number, message: string }) => `${error.statusCode} ${error.message}`)
	expect(await refusal(authorize(can.readListing, people.member, listing('unlisted')))).toBe('404 Listing not found')
	expect(await refusal(authorize(can.editListing, people.member, listing('removed')))).toBe('404 Listing not found')
	expect(await refusal(authorize(can.editListing, people.member, listing('listed')))).toBe('403 Only its publisher can change this listing')
	expect(await refusal(authorize(can.editListing, people.publisher, listing('removed')))).toBe('403 This listing was removed by a moderator')
	expect(await refusal(authorize(can.publish, people.member, { publishing: false }))).toBe('403 Publishing to Explore is turned off on this instance')
	expect(await refusal(authorize(can.deleteListing, people.member, listing('listed')))).toBe('403 Only its publisher can delete this listing')
})
