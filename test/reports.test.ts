import { beforeEach, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import * as schema from '../server/db/schema'
import { browseListings, browseQuerySchema } from '../server/utils/explore/browse'
import { findListing, myListings, publishListing } from '../server/utils/explore/listings'
import type { Store } from '../server/utils/explore/package'
import { exploreCounts, openReports, reportListing, resolveReport } from '../server/utils/explore/reports'
import { reviewVersion } from '../server/utils/explore/reviews'
import { EXPLORE_DEFAULTS } from '../shared/utils/package'
import { createTestDb, type TestDb } from './db'

let db: TestDb
const store: Store = { get: async () => null, put: async () => {}, del: async () => {} }
let ids: Record<'admin' | 'moderator' | 'alice' | 'bob' | 'carol', string>
let listing: { id: string, ownerId: string }

beforeEach(async () => {
	db = await createTestDb()
	const rows = await db.insert(schema.user).values([
		{ githubId: 1, username: 'admin', role: 'admin' as const },
		{ githubId: 2, username: 'moderator', role: 'moderator' as const },
		{ githubId: 3, username: 'alice' },
		{ githubId: 4, username: 'bob' },
		{ githubId: 5, username: 'carol' },
	]).returning()
	ids = Object.fromEntries(rows.map(row => [row.username, row.id])) as typeof ids
	const [character] = await db.insert(schema.character).values({ ownerId: ids.alice, name: 'Writer' }).returning()
	listing = (await publish(character!.id, EXPLORE_DEFAULTS)).listing
})

const publish = async (characterId: string, settings: typeof EXPLORE_DEFAULTS) =>
	publishListing(db, store, { userId: ids.alice, texts: { name: 'Writer', summary: '', description: '', tags: [], category: null }, source: { characterIds: [characterId] }, settings })
const report = (userId: string, reason = 'It insults people.') => reportListing(db, { userId, listing, reason })
const counts = (id: string, staff = false) => exploreCounts(db, { id, staff })

test('a member reports a listing once while the report is open; its publisher cannot report their own', async () => {
	await report(ids.bob)
	await expect(report(ids.bob, 'Again')).rejects.toThrow(expect.objectContaining({ status: 409 }))
	await report(ids.carol, 'Spam')
	await expect(report(ids.alice)).rejects.toThrow(expect.objectContaining({ status: 400 }))
	expect((await openReports(db)).map(entry => [entry.reporter.username, entry.reason, entry.name, entry.publisher])).toEqual([['bob', 'It insults people.', 'Writer', 'alice'], ['carol', 'Spam', 'Writer', 'alice']])
})

test('dismissing leaves the listing on Explore and lets the member report it again; a settled report is refused', async () => {
	const first = await report(ids.bob)
	await resolveReport(db, { reportId: first.id, resolverId: ids.moderator, decision: { dismiss: true } })
	expect(await openReports(db)).toEqual([])
	expect((await findListing(db, listing.id))!.status).toBe('listed')
	const [settled] = await db.select().from(schema.listingReport).where(eq(schema.listingReport.id, first.id))
	expect([settled!.status, settled!.resolvedBy]).toEqual(['dismissed', ids.moderator])
	await expect(resolveReport(db, { reportId: first.id, resolverId: ids.admin, decision: { remove: true, reason: 'No' } })).rejects.toThrow(expect.objectContaining({ status: 409 }))
	await report(ids.bob, 'It still insults people.')
	expect((await openReports(db)).map(entry => entry.reason)).toEqual(['It still insults people.'])
})

test('removing from a report takes the listing off Explore with the reason its publisher reads, and settles every open report of it', async () => {
	const [bob, carol] = [await report(ids.bob), await report(ids.carol, 'Spam')]
	await resolveReport(db, { reportId: bob.id, resolverId: ids.admin, decision: { remove: true, reason: 'Insults members.' } })
	expect(await openReports(db)).toEqual([])
	const settled = await db.select().from(schema.listingReport)
	expect(Object.fromEntries(settled.map(row => [row.id, row.status]))).toEqual({ [bob.id]: 'acted', [carol.id]: 'acted' })
	expect((await myListings(db, ids.alice)).map(entry => [entry.status, entry.statusReason])).toEqual([['removed', 'Insults members.']])
	expect((await browseListings(db, browseQuerySchema.parse({}), ids.bob)).listings).toEqual([])
})

test('the counts beside Explore: a publisher\'s rejected or removed listings; for reviewers, what waits for them', async () => {
	expect([await counts(ids.alice), await counts(ids.admin, true)]).toEqual([{ attention: 0, waiting: 0 }, { attention: 0, waiting: 0 }])
	// A report waits for reviewers; members see no waiting count.
	const first = await report(ids.bob)
	expect([await counts(ids.bob), await counts(ids.moderator, true)]).toEqual([{ attention: 0, waiting: 0 }, { attention: 0, waiting: 1 }])
	// A second listing waiting for review: one more for the reviewers.
	const [character] = await db.insert(schema.character).values({ ownerId: ids.alice, name: 'Planner' }).returning()
	const waiting = (await publish(character!.id, { ...EXPLORE_DEFAULTS, publishing: 'reviewed' })).listing
	expect(await counts(ids.moderator, true)).toEqual({ attention: 0, waiting: 2 })
	// Rejected and removed: both need the publisher; nothing waits any more.
	const [version] = await db.select().from(schema.listingVersion).where(eq(schema.listingVersion.listingId, waiting.id))
	await reviewVersion(db, { versionId: version!.id, reviewerId: ids.moderator, decision: { reject: true, reason: 'Say what it plans.' } })
	await resolveReport(db, { reportId: first.id, resolverId: ids.moderator, decision: { remove: true, reason: 'Insults members.' } })
	expect([await counts(ids.alice), await counts(ids.moderator, true)]).toEqual([{ attention: 2, waiting: 0 }, { attention: 0, waiting: 0 }])
	// A reviewer's own waiting publication is not theirs to review.
	const [own] = await db.insert(schema.character).values({ ownerId: ids.moderator, name: 'Own' }).returning()
	await publishListing(db, store, { userId: ids.moderator, texts: { name: 'Own', summary: '', description: '', tags: [], category: null }, source: { characterIds: [own!.id] }, settings: { ...EXPLORE_DEFAULTS, publishing: 'reviewed' } })
	expect([await counts(ids.moderator, true), await counts(ids.admin, true)]).toEqual([{ attention: 0, waiting: 0 }, { attention: 0, waiting: 1 }])
})
