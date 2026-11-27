import { beforeEach, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import * as schema from '../server/db/schema'
import { type Store, takePackage } from '../server/utils/explore/package'
import { deleteListing, findListing, publishUpdate } from '../server/utils/explore/listings'
import { getListing } from '../server/utils/explore/browse'
import { changePackage, createPackage, deletePackage, findPackage, myPackages, packageFromFolder, publishPackage } from '../server/utils/explore/packages'
import type { FolderDefaults } from '../shared/utils/folderDefaults'
import { EXPLORE_DEFAULTS, NO_PACKAGE_ITEMS, packageItemsSchema } from '../shared/utils/package'
import { createTestDb, type TestDb } from './db'

let db: TestDb
let alice: string
let bob: string
const store: Store = { get: async () => null, put: async () => {}, del: async () => {} }

beforeEach(async () => {
	db = await createTestDb()
	const users = await db.insert(schema.user).values([1, 2].map(githubId => ({ githubId, username: `u${githubId}` }))).returning()
	;[alice, bob] = users.map(user => user.id) as [string, string]
})

const characters = async (...names: string[]) => (await db.insert(schema.character).values(names.map(name => ({ ownerId: alice, name, instructions: `You are ${name}.` }))).returning()).map(row => row.id)

test('another member\'s package is not found for reading, changing, deleting or publishing', async () => {
	const { id } = await createPackage(db, alice, 'Team')
	const notFound = expect.objectContaining({ status: 404, message: 'Package not found' })
	await expect(findPackage(db, bob, id)).rejects.toThrow(notFound)
	await expect(changePackage(db, bob, id, { name: 'Mine now' })).rejects.toThrow(notFound)
	await expect(deletePackage(db, store, bob, id)).rejects.toThrow(notFound)
	await expect(takePackage(db, bob, { packageId: id })).rejects.toThrow(notFound)
	await expect(findPackage(db, alice, 'not-an-id')).rejects.toThrow(notFound)
	expect(await myPackages(db, bob)).toEqual([])
	expect((await findPackage(db, alice, id)).name).toBe('Team')
})

test('a package\'s setup is taken with it, after its items', async () => {
	const [engineer, designer, critic] = await characters('Engineer', 'Designer', 'Critic')
	const [library] = await db.insert(schema.library).values({ ownerId: alice, name: 'Specs' }).returning()
	const setup: FolderDefaults = { libraryIds: [library!.id], structureProfileId: null, mode: 'group', models: [{ characterId: engineer!, modelId: 'deepseek-flash' }, { characterId: designer!, modelId: 'deepseek-flash' }] }
	const { id } = await createPackage(db, alice, 'Team')
	await changePackage(db, alice, id, { setup })
	const taken = await takePackage(db, alice, { packageId: id })
	expect(taken.content.setup?.mode).toBe('group')
	expect(taken.content.characters.map(character => character.name)).toEqual(['Engineer', 'Designer'])

	// Items are asked for, so they come first, then what the setup names.
	await changePackage(db, alice, id, { items: { ...NO_PACKAGE_ITEMS, characterIds: [critic!] } })
	const withItems = await takePackage(db, alice, { packageId: id })
	expect(withItems.content.characters.map(character => character.name)).toEqual(['Critic', 'Engineer', 'Designer'])
	expect(withItems.content.libraries.map(entry => entry.name)).toEqual(['Specs'])
})

test('a package made from a folder holds its setup and, as items, its lanes\' Characters, libraries and profile that are the member\'s', async () => {
	const [engineer, designer] = await characters('Engineer', 'Designer')
	const [specs] = await db.insert(schema.library).values({ ownerId: alice, name: 'Specs' }).returning()
	const [theirs] = await db.insert(schema.library).values({ ownerId: bob, name: 'Theirs' }).returning()
	const [group] = await db.insert(schema.structureProfile).values({ ownerId: alice, name: 'Group', blocks: [{ id: 'b1', kind: 'history' }] }).returning()
	const [profile] = await db.insert(schema.modelProfile).values({ ownerId: alice, name: 'Design', platform: 'deepseek', modelId: 'deepseek-flash', characterId: designer! }).returning()
	// The Engineer twice, the Designer through the model profile, and a lane with no Character.
	const setup: FolderDefaults = {
		libraryIds: [specs!.id, theirs!.id],
		structureProfileId: group!.id,
		mode: 'group',
		models: [{ characterId: engineer!, modelId: 'deepseek-flash' }, { profileId: profile!.id }, { characterId: engineer!, name: 'Second opinion' }, { name: 'Reviewer', characterId: null }],
	}
	const [folder] = await db.insert(schema.chatFolder).values({ userId: alice, name: 'Dev team', defaults: setup }).returning()

	const made = await packageFromFolder(db, alice, folder!.id)
	expect(made.name).toBe('Dev team')
	expect(made.setup).toEqual(setup)
	expect(made.items).toEqual({ characterIds: [engineer!, designer!], libraryIds: [specs!.id], structureProfileIds: [group!.id] })
	expect(made.listingId).toBeNull()
	const taken = await takePackage(db, alice, { packageId: made.id })
	expect(taken.content.characters.map(character => character.name)).toEqual(['Engineer', 'Designer'])
	expect(taken.content.setup?.mode).toBe('group')

	// Another member's folder is not found; one with no setup has nothing to make a package of.
	await expect(packageFromFolder(db, bob, folder!.id)).rejects.toThrow(expect.objectContaining({ status: 404, message: 'Folder not found' }))
	const [plain] = await db.insert(schema.chatFolder).values({ userId: alice, name: 'Plain' }).returning()
	await expect(packageFromFolder(db, alice, plain!.id)).rejects.toThrow(expect.objectContaining({ status: 400 }))
})

test('an item deleted elsewhere drops out: when read, when taken, and from what is stored at the next save', async () => {
	const [engineer, designer] = await characters('Engineer', 'Designer')
	const { id } = await createPackage(db, alice, 'Team')
	await changePackage(db, alice, id, { items: { ...NO_PACKAGE_ITEMS, characterIds: [engineer!, designer!] } })
	await db.delete(schema.character).where(eq(schema.character.id, engineer!))

	expect((await findPackage(db, alice, id)).items.characterIds).toEqual([designer!])
	expect((await takePackage(db, alice, { packageId: id })).content.characters.map(character => character.name)).toEqual(['Designer'])
	const stored = async () => (await db.select().from(schema.contentPackage).where(eq(schema.contentPackage.id, id)))[0]!.items.characterIds
	expect(await stored()).toEqual([engineer!, designer!])
	await changePackage(db, alice, id, { name: 'Smaller team' })
	expect(await stored()).toEqual([designer!])
})

test('only the member\'s own items go in, within a listing\'s limits', async () => {
	const { id } = await createPackage(db, alice, 'Team')
	const [bobs] = await db.insert(schema.character).values({ ownerId: bob, name: 'Bob\'s' }).returning()
	await expect(changePackage(db, alice, id, { items: { ...NO_PACKAGE_ITEMS, characterIds: [bobs!.id] } })).rejects.toThrow(expect.objectContaining({ status: 404, message: 'Character not found' }))

	const twelve = await characters(...Array.from({ length: 12 }, (_, index) => `C${index}`))
	expect(packageItemsSchema.safeParse({ ...NO_PACKAGE_ITEMS, characterIds: [...twelve, crypto.randomUUID()] }).success).toBe(false)
	// Twelve asked for, and a setup naming a thirteenth: the listing's limit still holds.
	const [thirteenth] = await characters('Thirteenth')
	await changePackage(db, alice, id, { items: { ...NO_PACKAGE_ITEMS, characterIds: twelve }, setup: { libraryIds: [], structureProfileId: null, models: [{ characterId: thirteenth!, modelId: null }] } })
	await expect(takePackage(db, alice, { packageId: id })).rejects.toThrow('A listing holds at most 12 Characters')
})

const open = EXPLORE_DEFAULTS
const versionOf = async (listingId: string, number: number) => (await db.select().from(schema.listingVersion).where(eq(schema.listingVersion.listingId, listingId))).find(version => version.number === number)!

test('publishing links the listing and takes the package\'s texts; it is published once, and updates read the package as it is now', async () => {
	const [engineer, designer] = await characters('Engineer', 'Designer')
	const { id } = await createPackage(db, alice, 'Dev team')
	await changePackage(db, alice, id, { items: { ...NO_PACKAGE_ITEMS, characterIds: [engineer!] }, texts: { summary: 'Builds things', description: '', tags: ['team'], category: null } })
	const { listing, pending } = await publishPackage(db, store, { userId: alice, packageId: id, settings: open })
	expect([pending, (await findPackage(db, alice, id)).listingId]).toEqual([false, listing.id])
	expect(listing).toMatchObject({ name: 'Dev team', summary: 'Builds things', tags: ['team'], kind: 'pack', source: { packageId: id } })
	await expect(publishPackage(db, store, { userId: alice, packageId: id, settings: open })).rejects.toThrow(expect.objectContaining({ status: 409 }))

	// Changed and added to since: the update holds what the package holds now.
	await db.update(schema.character).set({ instructions: 'You build carefully.' }).where(eq(schema.character.id, engineer!))
	await changePackage(db, alice, id, { items: { ...NO_PACKAGE_ITEMS, characterIds: [engineer!, designer!] } })
	await publishUpdate(db, store, { listing: (await findListing(db, listing.id))!, notes: 'A designer joins', settings: open })
	const second = await versionOf(listing.id, 2)
	expect(second.content.characters.map(character => [character.name, character.instructions])).toEqual([['Engineer', 'You build carefully.'], ['Designer', 'You are Designer.']])
	expect((await versionOf(listing.id, 1)).content.characters.map(character => character.instructions)).toEqual(['You are Engineer.'])
})

test('a package made from a folder got from Explore is based on the listing it came from', async () => {
	const [engineer, designer] = await characters('Engineer', 'Designer')
	const { id } = await createPackage(db, alice, 'Dev team')
	await changePackage(db, alice, id, { setup: { libraryIds: [], structureProfileId: null, mode: 'group', models: [{ characterId: engineer!, modelId: null }, { characterId: designer!, modelId: null }] } })
	const { listing } = await publishPackage(db, store, { userId: alice, packageId: id, settings: open })

	await getListing(db, store, listing, bob)
	const [folder] = await db.select().from(schema.chatFolder).where(eq(schema.chatFolder.userId, bob))
	const theirs = await packageFromFolder(db, bob, folder!.id)
	const derived = await publishPackage(db, store, { userId: bob, packageId: theirs.id, settings: open })
	expect(derived.listing.basedOnId).toBe(listing.id)
})

test('in reviewed mode a package waits, and its update is refused while one waits', async () => {
	await db.insert(schema.user).values({ githubId: 3, username: 'moderator', role: 'moderator' })
	const [engineer] = await characters('Engineer')
	const { id } = await createPackage(db, alice, 'Dev team')
	await changePackage(db, alice, id, { items: { ...NO_PACKAGE_ITEMS, characterIds: [engineer!] } })
	const reviewed = { ...EXPLORE_DEFAULTS, publishing: 'reviewed' as const }
	const { listing, pending } = await publishPackage(db, store, { userId: alice, packageId: id, settings: reviewed })
	expect([pending, listing.currentVersionId]).toEqual([true, null])
	await expect(publishUpdate(db, store, { listing, notes: 'Again', settings: reviewed })).rejects.toThrow(expect.objectContaining({ status: 409, message: 'An update of this listing is waiting for review' }))
})

test('deleting the listing makes the package a draft again; deleting the package deletes its listing', async () => {
	const [engineer] = await characters('Engineer')
	const { id } = await createPackage(db, alice, 'Dev team')
	await changePackage(db, alice, id, { items: { ...NO_PACKAGE_ITEMS, characterIds: [engineer!] } })
	const first = await publishPackage(db, store, { userId: alice, packageId: id, settings: open })
	await deleteListing(db, store, first.listing.id)
	expect((await findPackage(db, alice, id)).listingId).toBeNull()

	const again = await publishPackage(db, store, { userId: alice, packageId: id, settings: open })
	await deletePackage(db, store, alice, id)
	expect(await findListing(db, again.listing.id)).toBeUndefined()
	expect(await db.select().from(schema.character)).toHaveLength(1)
})
