import { beforeEach, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import * as schema from '../server/db/schema'
import { browseListings, browseQuerySchema, getListing, listingPage } from '../server/utils/explore/browse'
import { findListing, publishListing, publishUpdate } from '../server/utils/explore/listings'
import type { Store } from '../server/utils/explore/package'
import { EXPLORE_DEFAULTS, type PackageSource } from '../shared/utils/package'
import { createTestDb, type TestDb } from './db'

let db: TestDb
let stored: Record<string, Blob>
const store: Store = {
	get: async path => stored[path] ?? null,
	put: async (path, data) => void (stored[path] = data),
	del: async (path) => {
		const { [path]: _gone, ...kept } = stored
		stored = kept
	},
}
const settings = { ...EXPLORE_DEFAULTS, categories: ['Roleplay', 'Work'] }
let users: Record<'alice' | 'bob' | 'carol' | 'dave', string>
let ids: Record<string, string>

async function publish(owner: string, name: string, summary: string, tags: string[], category: string | null, source: PackageSource, day: number) {
	const { listing } = await publishListing(db, store, { userId: owner, texts: { name, summary, description: '', tags, category }, source, settings })
	await db.update(schema.listing).set({ publishedAt: new Date(Date.UTC(2026, 10, day)) }).where(eq(schema.listing.id, listing.id))
	return listing.id
}
const names = async (query: Record<string, unknown>) => (await browseListings(db, browseQuerySchema.parse(query), users.bob)).listings.map(listing => listing.name)

beforeEach(async () => {
	db = await createTestDb()
	stored = {}
	const rows = await db.insert(schema.user).values([
		{ githubId: 1, username: 'alice' },
		{ githubId: 2, username: 'bob' },
		// Banned with no end: hidden.
		{ githubId: 3, username: 'carol', banned: true },
		// Banned until yesterday: shown again.
		{ githubId: 4, username: 'dave', banned: true, banExpires: new Date(Date.now() - 86_400_000) },
	]).returning()
	users = Object.fromEntries(rows.map(row => [row.username, row.id])) as typeof users
	const { alice, carol, dave } = users

	const seraphinaId = randomUUID()
	stored[`avatars/${seraphinaId}/a.png`] = new Blob(['a face'])
	const [avatar] = await db.insert(schema.file).values({ ownerId: alice, blobPath: `avatars/${seraphinaId}/a.png`, fileName: 'a.png', mediaType: 'image/png', size: 6 }).returning()
	const [seraphina, engineer, designer, mine, theirs] = await db.insert(schema.character).values([
		{ id: seraphinaId, ownerId: alice, name: 'Seraphina', instructions: 'Guard the glade.', avatarFileId: avatar!.id },
		{ ownerId: alice, name: 'Engineer', instructions: 'You build things.' },
		{ ownerId: alice, name: 'Designer', instructions: 'You design things.' },
		{ ownerId: carol, name: 'Banned one' },
		{ ownerId: dave, name: 'Forgiven one' },
	]).returning()
	const [notes] = await db.insert(schema.library).values({ ownerId: alice, name: 'Notes' }).returning()
	const [folder] = await db.insert(schema.chatFolder).values({ userId: alice, name: 'Dev Team', defaults: { libraryIds: [], structureProfileId: null, mode: 'group', models: [{ characterId: engineer!.id }, { characterId: designer!.id }] } }).returning()

	ids = {
		seraphina: await publish(alice, 'Seraphina', 'A gentle guardian of the glade', ['fantasy'], 'Roleplay', { characterIds: [seraphina!.id] }, 1),
		team: await publish(alice, 'Dev Team', 'An Engineer and a Designer answering in turn', ['coding', 'team'], 'Work', { folderId: folder!.id }, 2),
		notes: await publish(alice, 'Notes', 'Research notes, 100% sourced', ['research'], null, { libraryIds: [notes!.id] }, 3),
		hidden: await publish(alice, 'Hidden draft', 'Not ready', [], null, { characterIds: [engineer!.id] }, 4),
		removed: await publish(alice, 'Removed one', 'Taken down', [], null, { characterIds: [designer!.id] }, 5),
		banned: await publish(carol, 'Banned one', 'From a banned member', [], null, { characterIds: [mine!.id] }, 6),
		forgiven: await publish(dave, 'Forgiven one', 'From a member whose ban is over', [], null, { characterIds: [theirs!.id] }, 0),
	}
	await db.update(schema.listing).set({ status: 'unlisted' }).where(eq(schema.listing.id, ids.hidden!))
	await db.update(schema.listing).set({ status: 'removed', statusReason: 'No' }).where(eq(schema.listing.id, ids.removed!))
	await db.update(schema.listing).set({ gets: 5 }).where(eq(schema.listing.id, ids.team!))
	await db.update(schema.listing).set({ gets: 2 }).where(eq(schema.listing.id, ids.notes!))
})

test('the grid shows listed listings only, and none of a member whose ban lasts', async () => {
	expect(await names({})).toEqual(['Notes', 'Dev Team', 'Seraphina', 'Forgiven one'])
	expect((await browseListings(db, browseQuerySchema.parse({}), users.bob)).total).toBe(4)
})

test('search: every word, in the name, summary or tags; % and _ are plain characters', async () => {
	expect(await names({ q: 'engineer' })).toEqual(['Dev Team'])
	expect(await names({ q: 'gentle  glade' })).toEqual(['Seraphina'])
	expect(await names({ q: 'gentle team' })).toEqual([])
	expect(await names({ q: 'FANTASY' })).toEqual(['Seraphina'])
	expect(await names({ q: '100%' })).toEqual(['Notes'])
	expect(await names({ q: '%' })).toEqual(['Notes'])
	expect(await names({ q: '_' })).toEqual([])
})

test('each filter: kind, category, tag', async () => {
	expect(await names({ kind: 'pack' })).toEqual(['Dev Team'])
	expect(await names({ kind: 'library' })).toEqual(['Notes'])
	expect(await names({ category: 'Work' })).toEqual(['Dev Team'])
	expect(await names({ tag: 'team' })).toEqual(['Dev Team'])
	expect(await names({ tag: 'Team', kind: 'character' })).toEqual([])
})

test('each sort, with featured listings first', async () => {
	expect(await names({ sort: 'gets' })).toEqual(['Dev Team', 'Notes', 'Seraphina', 'Forgiven one'])
	const seraphina = (await findListing(db, ids.seraphina))!
	await publishUpdate(db, store, { listing: seraphina, notes: 'Newer', settings })
	expect((await names({ sort: 'updated' }))[0]).toBe('Seraphina')
	await db.update(schema.listing).set({ featured: true }).where(eq(schema.listing.id, ids.forgiven!))
	expect(await names({ sort: 'newest' })).toEqual(['Forgiven one', 'Notes', 'Dev Team', 'Seraphina'])
	// A card carries the avatar its version owns.
	const cards = (await browseListings(db, browseQuerySchema.parse({ kind: 'character', q: 'Seraphina' }), users.bob)).listings
	const [owned] = await db.select().from(schema.listingFile).where(eq(schema.listingFile.fileId, cards[0]!.avatarFileId!))
	expect(owned!.key).toBe('f1')
})

test('a listing\'s page holds what is in it; "Get" makes the member\'s copies, counts once, and the page says which version they have', async () => {
	const team = (await findListing(db, ids.team))!
	const page = await listingPage(db, team, users.bob)
	expect(page.got).toBeNull()
	expect(page.publisher.username).toBe('alice')
	expect('source' in page.listing).toBe(false)
	expect(page.version!.content.characters.map(character => [character.name, character.instructions])).toEqual([['Engineer', 'You build things.'], ['Designer', 'You design things.']])
	expect(page.versions.map(version => version.number)).toEqual([1])

	const made = await getListing(db, store, team, users.bob)
	expect(made.version).toBe(1)
	const [folder] = await db.select().from(schema.chatFolder).where(eq(schema.chatFolder.id, made.folderId!))
	expect([folder!.userId, folder!.name, folder!.defaults?.mode]).toEqual([users.bob, 'Dev Team', 'group'])
	await getListing(db, store, team, users.bob)
	await getListing(db, store, team, users.alice)
	expect((await findListing(db, ids.team))!.gets).toBe(6)
	expect(await db.select().from(schema.acquisition).where(eq(schema.acquisition.userId, users.bob))).toHaveLength(2)

	// A new version: the member has version 1 of 2.
	await publishUpdate(db, store, { listing: team, notes: 'A reviewer joins', settings })
	const later = await listingPage(db, (await findListing(db, ids.team))!, users.bob)
	expect([later.got, later.version!.number]).toEqual([1, 2])
	expect(later.versions.map(version => [version.number, version.notes])).toEqual([[2, 'A reviewer joins'], [1, '']])
})
