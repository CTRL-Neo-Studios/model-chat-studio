import { beforeEach, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import * as schema from '../server/db/schema'
import { type Store, takePackage } from '../server/utils/explore/package'
import { changePackage, createPackage, deletePackage, findPackage, myPackages } from '../server/utils/explore/packages'
import type { FolderDefaults } from '../shared/utils/folderDefaults'
import { NO_PACKAGE_ITEMS, packageItemsSchema } from '../shared/utils/package'
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

test('a package\'s setup and items are taken as a folder\'s are', async () => {
	const [engineer, designer, critic] = await characters('Engineer', 'Designer', 'Critic')
	const [library] = await db.insert(schema.library).values({ ownerId: alice, name: 'Specs' }).returning()
	const setup: FolderDefaults = { libraryIds: [library!.id], structureProfileId: null, mode: 'group', models: [{ characterId: engineer!, modelId: 'deepseek-flash' }, { characterId: designer!, modelId: 'deepseek-flash' }] }
	const [folder] = await db.insert(schema.chatFolder).values({ userId: alice, name: 'Team', defaults: setup }).returning()

	const { id } = await createPackage(db, alice, 'Team')
	await changePackage(db, alice, id, { setup })
	const [fromFolder, fromPackage] = await Promise.all([takePackage(db, alice, { folderId: folder!.id }), takePackage(db, alice, { packageId: id })])
	expect(fromPackage).toEqual(fromFolder)
	expect(fromPackage.content.setup?.mode).toBe('group')

	// Items are asked for, so they come first, then what the setup names.
	await changePackage(db, alice, id, { items: { ...NO_PACKAGE_ITEMS, characterIds: [critic!] } })
	const withItems = await takePackage(db, alice, { packageId: id })
	expect(withItems.content.characters.map(character => character.name)).toEqual(['Critic', 'Engineer', 'Designer'])
	expect(withItems.content.libraries.map(entry => entry.name)).toEqual(['Specs'])
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
