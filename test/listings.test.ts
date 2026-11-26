import { beforeEach, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import * as schema from '../server/db/schema'
import { changeListing, deleteListing, myListings, previewListing, publishListing, publishUpdate } from '../server/utils/explore/listings'
import type { Store } from '../server/utils/explore/package'
import { EXPLORE_DEFAULTS } from '../shared/utils/package'
import { createTestDb, type TestDb } from './db'

let db: TestDb
let publisher: string
let other: string
let characterId: string
let stored: Record<string, Blob>
const store: Store = {
	get: async path => stored[path] ?? null,
	put: async (path, data) => void (stored[path] = data),
	del: async (path) => {
		const { [path]: _gone, ...kept } = stored
		stored = kept
	},
}
const settings = { ...EXPLORE_DEFAULTS, categories: ['Roleplay'] }
const texts = { name: 'Seraphina', summary: 'A gentle guardian', description: '# Seraphina\nGuards the glade.', tags: ['fantasy'], category: 'Roleplay' }

beforeEach(async () => {
	db = await createTestDb()
	stored = {}
	const users = await db.insert(schema.user).values([1, 2].map(githubId => ({ githubId, username: `u${githubId}` }))).returning()
	;[publisher, other] = users.map(user => user.id) as [string, string]
	// A Character with an avatar, reading a library of the publisher's and one shared with them.
	characterId = randomUUID()
	const avatarPath = `avatars/${characterId}/a.png`
	stored[avatarPath] = new Blob(['a face'])
	const [avatar] = await db.insert(schema.file).values({ ownerId: publisher, blobPath: avatarPath, fileName: 'a.png', mediaType: 'image/png', size: 6 }).returning()
	await db.insert(schema.character).values({ id: characterId, ownerId: publisher, name: 'Seraphina', instructions: 'Guard the glade.', avatarFileId: avatar!.id })
	const [lore] = await db.insert(schema.library).values({ ownerId: publisher, name: 'Eldoria' }).returning()
	const [shared] = await db.insert(schema.library).values({ ownerId: other, name: 'Shared notes' }).returning()
	await db.insert(schema.characterLibrary).values([{ characterId, libraryId: lore!.id, createdAt: new Date(1) }, { characterId, libraryId: shared!.id, createdAt: new Date(2) }])
})

test('publishing makes version 1 with its own copies of the files, and says what it left out', async () => {
	const preview = await previewListing(db, publisher, { characterIds: [characterId] }, settings)
	expect(preview).toMatchObject({ kind: 'character', characters: ['Seraphina'], libraries: [{ name: 'Eldoria', entries: 0 }], files: 1, left: ['The library “Shared notes” is not yours, so it is left out'] })

	const { listing, left } = await publishListing(db, store, { userId: publisher, texts, source: { characterIds: [characterId] }, settings })
	expect(left).toEqual(preview.left)
	expect(listing).toMatchObject({ ownerId: publisher, kind: 'character', status: 'listed', ...texts, source: { characterIds: [characterId] }, basedOnId: null })
	const [version] = await db.select().from(schema.listingVersion).where(eq(schema.listingVersion.id, listing.currentVersionId!))
	expect(version!.number).toBe(1)
	// The version owns a copy of the avatar, under its own path, with the same bytes.
	const [owned] = await db.select().from(schema.listingFile).innerJoin(schema.file, eq(schema.file.id, schema.listingFile.fileId)).where(eq(schema.listingFile.versionId, version!.id))
	expect(owned!.listingFile.key).toBe('f1')
	expect(owned!.file.blobPath).toBe(`explore/${version!.id}/f1.png`)
	expect(await stored[owned!.file.blobPath]!.text()).toBe('a face')

	// The listing is a snapshot: changing the Character afterwards changes nothing on it.
	await db.update(schema.character).set({ name: 'Seraphina the Second' }).where(eq(schema.character.id, characterId))
	const [still] = await db.select().from(schema.listingVersion).where(eq(schema.listingVersion.id, version!.id))
	expect(still!.content.characters[0]!.name).toBe('Seraphina')
})

test('an update is version 2 with its note; version 1 stays as it was', async () => {
	const { listing } = await publishListing(db, store, { userId: publisher, texts, source: { characterIds: [characterId] }, settings })
	await db.update(schema.character).set({ instructions: 'Guard the glade, and the river.' }).where(eq(schema.character.id, characterId))
	const { listing: updated } = await publishUpdate(db, store, { listing, notes: 'Now guards the river too.', settings })
	const versions = await db.select().from(schema.listingVersion).where(eq(schema.listingVersion.listingId, listing.id)).orderBy(asc(schema.listingVersion.number))
	expect(versions.map(version => [version.number, version.notes, version.content.characters[0]!.instructions])).toEqual([
		[1, '', 'Guard the glade.'],
		[2, 'Now guards the river too.', 'Guard the glade, and the river.'],
	])
	expect(updated.currentVersionId).toBe(versions[1]!.id)
	expect((await myListings(db, publisher)).map(row => [row.name, row.version])).toEqual([['Seraphina', 2]])
	// Another kind of content is not an update of this listing.
	const [library] = await db.select().from(schema.library).where(eq(schema.library.ownerId, publisher))
	await expect(publishUpdate(db, store, { listing, notes: 'A library now', source: { libraryIds: [library!.id] }, settings })).rejects.toThrow('An update holds the same kind of content as the listing')
})

test('a category the instance does not keep, and a listing over the size limit, are refused', async () => {
	await expect(publishListing(db, store, { userId: publisher, texts: { ...texts, category: 'Other' }, source: { characterIds: [characterId] }, settings })).rejects.toThrow('“Other” is not one of Explore\'s categories')
	await db.update(schema.file).set({ size: 2 * 1024 * 1024 }).where(eq(schema.file.ownerId, publisher))
	await expect(publishListing(db, store, { userId: publisher, texts, source: { characterIds: [characterId] }, settings: { ...settings, maxSizeMb: 1 } })).rejects.toThrow(expect.objectContaining({ status: 413, message: 'A listing can be at most 1 MB with its files' }))
	expect(await db.select().from(schema.listing)).toEqual([])
})

test('a listing published from a copy got from Explore names the listing it came from', async () => {
	const { listing } = await publishListing(db, store, { userId: publisher, texts, source: { characterIds: [characterId] }, settings })
	const [copy] = await db.insert(schema.character).values({ ownerId: other, name: 'Seraphina' }).returning()
	await db.insert(schema.acquisition).values({ userId: other, listingId: listing.id, versionId: listing.currentVersionId, created: { characterIds: [copy!.id], libraryIds: [], structureProfileIds: [], folderId: null } })
	const { listing: derived } = await publishListing(db, store, { userId: other, texts, source: { characterIds: [copy!.id] }, settings })
	expect(derived.basedOnId).toBe(listing.id)
})

test('a moderator\'s removal shows its reason to the publisher; deleting removes the versions and their files, not the publisher\'s items', async () => {
	const { listing } = await publishListing(db, store, { userId: publisher, texts, source: { characterIds: [characterId] }, settings })
	await publishUpdate(db, store, { listing, notes: 'Again', settings })
	await changeListing(db, listing, { status: 'removed', statusReason: 'Copied from someone else' }, settings)
	expect((await myListings(db, publisher)).map(row => [row.status, row.statusReason])).toEqual([['removed', 'Copied from someone else']])

	const before = Object.keys(stored).filter(path => path.startsWith('explore/'))
	expect(before).toHaveLength(2)
	await deleteListing(db, store, listing.id)
	expect(await db.select().from(schema.listing)).toEqual([])
	expect(await db.select().from(schema.listingVersion)).toEqual([])
	expect(Object.keys(stored).filter(path => path.startsWith('explore/'))).toEqual([])
	const files = await db.select().from(schema.file)
	expect(files.map(file => file.blobPath)).toEqual([`avatars/${characterId}/a.png`])
	expect(await db.select().from(schema.character).where(eq(schema.character.id, characterId))).toHaveLength(1)
})
