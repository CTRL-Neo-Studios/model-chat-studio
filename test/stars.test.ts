import { beforeEach, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import * as schema from '../server/db/schema'
import { browseListings, browseQuerySchema } from '../server/utils/explore/browse'
import { publishListing } from '../server/utils/explore/listings'
import type { Store } from '../server/utils/explore/package'
import { addToList, changeList, createList, deleteList, myStars, removeFromList, starListing, unstarListing } from '../server/utils/explore/stars'
import { EXPLORE_DEFAULTS } from '../shared/utils/package'
import { createTestDb, type TestDb } from './db'

let db: TestDb
const store: Store = { get: async () => null, put: async () => {}, del: async () => {} }
let alice: string
let bob: string
let carol: string
let first: string
let second: string

const stars = async (listingId: string) => (await db.select({ stars: schema.listing.stars }).from(schema.listing).where(eq(schema.listing.id, listingId)))[0]!.stars

beforeEach(async () => {
	db = await createTestDb()
	const users = await db.insert(schema.user).values([1, 2, 3].map(githubId => ({ githubId, username: `u${githubId}` }))).returning()
	;[alice, bob, carol] = users.map(user => user.id) as [string, string, string]
	const characters = await db.insert(schema.character).values([{ ownerId: alice, name: 'Writer' }, { ownerId: alice, name: 'Planner' }]).returning()
	const publish = async (name: string, characterId: string) => (await publishListing(db, store, { userId: alice, texts: { name, summary: `${name}'s summary`, description: '', tags: ['work'], category: null }, source: { characterIds: [characterId] }, settings: EXPLORE_DEFAULTS })).listing.id
	first = await publish('Writer', characters[0]!.id)
	second = await publish('Planner', characters[1]!.id)
})

test('a star counts once per member', async () => {
	await starListing(db, bob, first)
	await starListing(db, bob, first)
	expect(await stars(first)).toBe(1)
	await starListing(db, carol, first)
	expect(await stars(first)).toBe(2)
	await unstarListing(db, bob, first)
	await unstarListing(db, bob, first)
	expect(await stars(first)).toBe(1)
})

test('putting a listing in a list stars it; unstarring takes it out of every list, and the lists stay', async () => {
	const productivity = await createList(db, bob, { name: 'Productivity', description: '' })
	const writing = await createList(db, bob, { name: 'Writing', description: 'For drafts' })
	await addToList(db, bob, productivity.id, second)
	await addToList(db, bob, productivity.id, second)
	await addToList(db, bob, writing.id, second)
	expect(await stars(second)).toBe(1)
	let mine = await myStars(db, bob)
	expect(mine.listings.map(card => [card.name, card.starred, card.stars])).toEqual([['Planner', true, 1]])
	expect(mine.lists.map(list => [list.name, list.listingIds])).toEqual([['Productivity', [second]], ['Writing', [second]]])

	// Out of one list, still starred and in the other.
	await removeFromList(db, bob, writing.id, second)
	mine = await myStars(db, bob)
	expect([mine.listings.length, mine.lists.map(list => list.listingIds.length)]).toEqual([1, [1, 0]])

	await unstarListing(db, bob, second)
	mine = await myStars(db, bob)
	expect(mine.listings).toEqual([])
	expect(mine.lists.map(list => [list.name, list.listingIds])).toEqual([['Productivity', []], ['Writing', []]])
	expect(await stars(second)).toBe(0)

	// Deleting a list keeps its listings starred.
	await addToList(db, bob, writing.id, first)
	await deleteList(db, bob, writing.id)
	mine = await myStars(db, bob)
	expect([mine.listings.map(card => card.name), mine.lists.map(list => list.name)]).toEqual([['Writer'], ['Productivity']])
})

test('another member\'s lists cannot be reached', async () => {
	const list = await createList(db, bob, { name: 'Private', description: '' })
	for (const attempt of [
		() => changeList(db, carol, list.id, { name: 'Mine now' }),
		() => deleteList(db, carol, list.id),
		() => addToList(db, carol, list.id, first),
		() => removeFromList(db, carol, list.id, first),
	]) await expect(attempt()).rejects.toThrow(expect.objectContaining({ status: 404, message: 'List not found' }))
	expect((await myStars(db, carol)).lists).toEqual([])
	expect(await stars(first)).toBe(0)
})

test('"most starred" sorts by stars, each card says whether the member starred it, and a removed listing stays in their stars as no longer available', async () => {
	await starListing(db, bob, second)
	await starListing(db, carol, second)
	await starListing(db, carol, first)
	const grid = (await browseListings(db, browseQuerySchema.parse({ sort: 'stars' }), bob)).listings
	expect(grid.map(card => [card.name, card.stars, card.starred])).toEqual([['Planner', 2, true], ['Writer', 1, false]])

	await db.update(schema.listing).set({ status: 'removed', statusReason: 'No' }).where(eq(schema.listing.id, second))
	const [card] = (await myStars(db, bob)).listings
	expect([card!.name, card!.available, card!.summary, card!.tags]).toEqual(['Planner', false, '', []])
	// Taken out of their stars all the same.
	await unstarListing(db, bob, second)
	expect((await myStars(db, bob)).listings).toEqual([])
})
