import { beforeEach, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { allows } from 'nuxt-authorization/utils'
import * as schema from '../server/db/schema'
import { browseListings, browseQuerySchema, listingPage } from '../server/utils/explore/browse'
import { findListing, myListings, NOT_REVIEWED, publishListing, publishUpdate } from '../server/utils/explore/listings'
import type { Store } from '../server/utils/explore/package'
import { pendingReviews, reviewVersion } from '../server/utils/explore/reviews'
import { exploreAbilities } from '../shared/abilities/exploreAbilities'
import { EXPLORE_DEFAULTS, exploreSettingsSchema } from '../shared/utils/package'
import type { User } from '../shared/types/db'
import { createTestDb, type TestDb } from './db'

let db: TestDb
const store: Store = { get: async () => null, put: async () => {}, del: async () => {} }
const open = EXPLORE_DEFAULTS
const reviewed = { ...EXPLORE_DEFAULTS, publishing: 'reviewed' as const }
const can = exploreAbilities()
let people: Record<'admin' | 'moderator' | 'alice' | 'bob', User>
let characters: Record<'alice' | 'moderator', string>

beforeEach(async () => {
	db = await createTestDb()
	const rows = await db.insert(schema.user).values([
		{ githubId: 1, username: 'admin', role: 'admin' as const },
		{ githubId: 2, username: 'moderator', role: 'moderator' as const },
		{ githubId: 3, username: 'alice' },
		{ githubId: 4, username: 'bob' },
	]).returning()
	people = Object.fromEntries(rows.map(row => [row.username, row])) as unknown as typeof people
	const made = await db.insert(schema.character).values([{ ownerId: people.alice.id, name: 'Writer', instructions: 'Version one.' }, { ownerId: people.moderator.id, name: 'Moderator\'s own' }]).returning()
	characters = { alice: made[0]!.id, moderator: made[1]!.id }
})

const publish = async (userId: string, characterId: string, settings: typeof open | typeof reviewed) =>
	publishListing(db, store, { userId, texts: { name: 'Writer', summary: 'Writes', description: '', tags: [], category: null }, source: { characterIds: [characterId] }, settings })
const grid = async (user: User) => (await browseListings(db, browseQuerySchema.parse({}), user.id)).listings.map(card => card.id)
const versionsOf = async (listingId: string) => (await db.select().from(schema.listingVersion).where(eq(schema.listingVersion.listingId, listingId))).toSorted((a, b) => a.number - b.number)
const approve = (versionId: string, reviewer: User) => reviewVersion(db, { versionId, reviewerId: reviewer.id, decision: { approve: true } })
const reject = (versionId: string, reviewer: User, reason: string) => reviewVersion(db, { versionId, reviewerId: reviewer.id, decision: { reject: true, reason } })

test('in open mode a publication is on Explore at once', async () => {
	const { listing, pending } = await publish(people.alice.id, characters.alice, open)
	expect([pending, listing.published]).toEqual([false, true])
	expect((await versionsOf(listing.id)).map(version => version.status)).toEqual(['approved'])
	expect(await grid(people.bob)).toEqual([listing.id])
})

test('in reviewed mode a new listing waits unseen by members, a reviewer reads it on its page, and approval puts it on Explore', async () => {
	const { listing, pending } = await publish(people.alice.id, characters.alice, reviewed)
	expect([pending, listing.published]).toEqual([true, false])
	expect(await grid(people.bob)).toEqual([])
	expect(await allows(can.readListing, people.bob, listing)).toBe(false)
	expect(await allows(can.readListing, people.alice, listing)).toBe(true)

	const [version] = await versionsOf(listing.id)
	const forReviewer = await listingPage(db, listing, { id: people.moderator.id, staff: true })
	expect([forReviewer.version?.status, forReviewer.reviewable]).toEqual(['pending', true])
	expect((await listingPage(db, listing, { id: people.alice.id, staff: false })).reviewable).toBe(false)
	expect((await pendingReviews(db)).map(entry => [entry.name, entry.update, entry.rejectedBefore])).toEqual([['Writer', false, null]])

	await db.update(schema.listing).set({ publishedAt: new Date(Date.UTC(2026, 0, 1)) }).where(eq(schema.listing.id, listing.id))
	await approve(version!.id, people.moderator)
	const after = (await findListing(db, listing.id))!
	expect([after.published, after.currentVersionId, after.publishedAt > new Date(Date.UTC(2026, 0, 2))]).toEqual([true, version!.id, true])
	expect((await versionsOf(listing.id))[0]).toMatchObject({ status: 'approved', reviewedBy: people.moderator.id })
	expect(await grid(people.bob)).toEqual([listing.id])
	expect(await pendingReviews(db)).toEqual([])
})

test('a rejection keeps it off Explore with its reason; publishing again is a new submission beside it; approval then shows it', async () => {
	const { listing } = await publish(people.alice.id, characters.alice, reviewed)
	const [first] = await versionsOf(listing.id)
	await reject(first!.id, people.admin, 'Say what it writes in the summary.')
	expect((await findListing(db, listing.id))!.published).toBe(false)
	expect((await myListings(db, people.alice.id))[0]!.versions.map(version => [version.number, version.status, version.reason])).toEqual([[1, 'rejected', 'Say what it writes in the summary.']])

	const again = await publishUpdate(db, store, { listing: (await findListing(db, listing.id))!, notes: 'The summary says it now.', settings: reviewed })
	expect(again.pending).toBe(true)
	expect((await myListings(db, people.alice.id))[0]!.versions.map(version => [version.number, version.status])).toEqual([[2, 'pending'], [1, 'rejected']])
	expect((await pendingReviews(db)).map(entry => [entry.number, entry.notes, entry.rejectedBefore])).toEqual([[2, 'The summary says it now.', 'Say what it writes in the summary.']])
	expect(await grid(people.bob)).toEqual([])

	await approve((await versionsOf(listing.id))[1]!.id, people.admin)
	expect(await grid(people.bob)).toEqual([listing.id])
})

test('an update waits while the approved version stays; a second waits its turn; a rejected one changes nothing', async () => {
	const { listing } = await publish(people.alice.id, characters.alice, open)
	await db.update(schema.character).set({ instructions: 'Version two.' }).where(eq(schema.character.id, characters.alice))
	expect((await publishUpdate(db, store, { listing, notes: 'Two', settings: reviewed })).pending).toBe(true)

	// Members see version 1 and only it; the publisher sees both, the update waiting.
	const forMember = await listingPage(db, (await findListing(db, listing.id))!, { id: people.bob.id, staff: false })
	expect([forMember.version?.number, forMember.version?.content.characters[0]?.instructions, forMember.versions.map(version => version.number)]).toEqual([1, 'Version one.', [1]])
	expect((await listingPage(db, (await findListing(db, listing.id))!, { id: people.alice.id, staff: false })).versions.map(version => [version.number, version.status])).toEqual([[2, 'pending'], [1, 'approved']])
	expect((await pendingReviews(db))[0]!.update).toBe(true)

	await expect(publishUpdate(db, store, { listing, notes: 'Three', settings: reviewed })).rejects.toThrow(expect.objectContaining({ status: 409, message: 'An update of this listing is waiting for review' }))
	const [, second] = await versionsOf(listing.id)
	await reject(second!.id, people.moderator, 'Not yet.')
	expect((await findListing(db, listing.id))!.currentVersionId).toBe(listing.currentVersionId)

	await publishUpdate(db, store, { listing, notes: 'Three', settings: reviewed })
	const third = (await versionsOf(listing.id))[2]!
	await approve(third.id, people.moderator)
	expect((await findListing(db, listing.id))!.currentVersionId).toBe(third.id)
	// A decision on a version that no longer waits is refused.
	await expect(approve(second!.id, people.moderator)).rejects.toThrow(expect.objectContaining({ status: 409 }))
})

test('nobody reviews their own; with no other reviewer, it goes up marked as not reviewed', async () => {
	const { listing, pending } = await publish(people.moderator.id, characters.moderator, reviewed)
	expect(pending).toBe(true)
	expect(await allows(can.review, people.moderator, listing)).toBe(false)
	expect(await allows(can.review, people.admin, listing)).toBe(true)

	// The admin banned, the moderator is the last reviewer: their next publication goes up, not reviewed.
	await db.update(schema.user).set({ banned: true }).where(eq(schema.user.id, people.admin.id))
	const last = await publish(people.moderator.id, characters.moderator, reviewed)
	expect([last.pending, last.listing.published]).toEqual([false, true])
	expect((await versionsOf(last.listing.id))[0]).toMatchObject({ status: 'approved', reason: NOT_REVIEWED, reviewedBy: null })
	// A member's still waits for the moderator.
	expect((await publish(people.alice.id, characters.alice, reviewed)).pending).toBe(true)
})

test('going back to open publishes nothing that waits; the setting stored before modes reads as one', async () => {
	const { listing } = await publish(people.alice.id, characters.alice, reviewed)
	const second = await db.insert(schema.character).values({ ownerId: people.alice.id, name: 'Planner' }).returning()
	const openOne = await publishListing(db, store, { userId: people.alice.id, texts: { name: 'Planner', summary: '', description: '', tags: [], category: null }, source: { characterIds: [second[0]!.id] }, settings: open })
	expect(await grid(people.bob)).toEqual([openOne.listing.id])
	expect((await findListing(db, listing.id))!.published).toBe(false)
	expect((await pendingReviews(db)).map(entry => entry.listingId)).toEqual([listing.id])

	expect(exploreSettingsSchema.parse({ publishing: true, categories: [], maxSizeMb: 25 }).publishing).toBe('open')
	expect(exploreSettingsSchema.parse({ publishing: false, categories: [], maxSizeMb: 25 }).publishing).toBe('off')
})
