import { beforeEach, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import * as schema from '../server/db/schema'
import { givePackage, type Store, takePackage } from '../server/utils/explore/package'
import { packageFromFolder } from '../server/utils/explore/packages'
import { folderDefaultsSchema } from '../shared/utils/folderDefaults'
import { createTestDb, type TestDb } from './db'

let db: TestDb
let publisher: string
let receiver: string
let other: string
// Storage in memory, as `blob` has it.
let stored: Record<string, { data: Blob, type: string }>
const store: Store = {
	get: async path => stored[path]?.data ?? null,
	put: async (path, data, { contentType }) => void (stored[path] = { data, type: contentType }),
	del: async (path) => {
		const { [path]: _gone, ...kept } = stored
		stored = kept
	},
}
const bytes = async (path: string) => Buffer.from(await stored[path]!.data.arrayBuffer())

beforeEach(async () => {
	db = await createTestDb()
	stored = {}
	const users = await db.insert(schema.user).values([1, 2, 3].map(githubId => ({ githubId, username: `u${githubId}` }))).returning()
	;[publisher, receiver, other] = users.map(user => user.id) as [string, string, string]
})

/** A stored file of the publisher's, as uploads and avatars are stored. */
async function storedFile(blobPath: string, content: string, mediaType = 'image/png') {
	const id = randomUUID()
	stored[blobPath] = { data: new Blob([content]), type: mediaType }
	await db.insert(schema.file).values({ id, ownerId: publisher, chatId: null, blobPath, fileName: blobPath.split('/').at(-1)!, mediaType, size: content.length })
	return id
}

/** A lorebook library with a folder, notes and a file. */
async function seedLibrary() {
	const [library] = await db.insert(schema.library).values({ ownerId: publisher, name: 'Eldoria', description: 'The forest', lorebook: { on: true, scanDepth: 4, recursive: true } }).returning()
	const [places] = await db.insert(schema.libraryEntry).values({ libraryId: library!.id, kind: 'folder', name: 'Places', tags: ['map'], createdBy: publisher }).returning()
	const fileId = await storedFile(`libraries/${library!.id}/${randomUUID()}.png`, 'the map')
	await db.insert(schema.libraryEntry).values([
		{ libraryId: library!.id, parentId: places!.id, kind: 'note', name: 'Glade', tags: ['glade', 'forest'], content: 'The glade is {{char}}\'s home.', lore: { enabled: true, constant: true, secondaryKeys: ['home'], position: 'depth', depth: 2 }, createdBy: publisher },
		{ libraryId: library!.id, kind: 'note', name: 'Eldoria', tags: [], content: 'All of the woods.', createdBy: publisher },
		{ libraryId: library!.id, kind: 'file', name: 'map.png', tags: ['map'], fileId, createdBy: publisher },
	])
	return { library: library!, places: places! }
}

test('a Character with its lorebook library, a file and an avatar comes out equal in another member\'s hands, with new ids', async () => {
	const { library } = await seedLibrary()
	// A library shared with the publisher, not theirs: the Character is published without it.
	const [shared] = await db.insert(schema.library).values({ ownerId: other, name: 'Shared notes' }).returning()
	await db.insert(schema.libraryMember).values({ libraryId: shared!.id, userId: publisher, role: 'viewer' })
	const characterId = randomUUID()
	const avatarFileId = await storedFile(`avatars/${characterId}/${randomUUID()}.png`, 'a face')
	await db.insert(schema.character).values({
		id: characterId, ownerId: publisher, name: 'Seraphina', color: 'emerald', instructions: 'You are {{char}}, guardian of the glade.', avatarFileId,
		greetings: ['Hello, traveller.', 'Welcome back.'], examples: '<START>\n{{user}}: Hi\n{{char}}: Hello.', note: 'Stay gentle.', creatorNotes: 'Made for tests.', tags: ['fantasy'], card: { extensions: { depth_prompt: { depth: 4 } } },
	})
	await db.insert(schema.characterLibrary).values([{ characterId, libraryId: library.id, createdAt: new Date(1) }, { characterId, libraryId: shared!.id, createdAt: new Date(2) }])

	const first = await takePackage(db, publisher, { characterIds: [characterId] })
	expect(first.left).toEqual(['The library “Shared notes” is not yours, so it is left out'])
	expect(first.content.characters.map(({ key, name, libraryKeys, avatarKey }) => ({ key, name, libraryKeys, avatarKey }))).toEqual([{ key: 'c1', name: 'Seraphina', libraryKeys: ['l1'], avatarKey: 'f1' }])
	// Folders first and parents before their children, then by name.
	expect(first.content.libraries[0]!.entries.map(entry => [entry.key, entry.parentKey, entry.name])).toEqual([['e1', null, 'Places'], ['e2', 'e1', 'Glade'], ['e3', null, 'Eldoria'], ['e4', null, 'map.png']])

	const made = await givePackage(db, store, { userId: receiver, content: first.content, paths: first.paths, folderName: 'Seraphina' })
	expect(made.folderId).toBeNull()
	// Taken again from the copies, the package is the same, field by field.
	const again = await takePackage(db, receiver, { characterIds: made.characterIds })
	expect(again.content).toEqual(first.content)
	expect(again.left).toEqual([])

	// The copies are the receiver's, under new ids, and their files are copies with the same bytes.
	expect(made.characterIds[0]).not.toBe(characterId)
	expect(made.libraryIds[0]).not.toBe(library.id)
	const [copy] = await db.select().from(schema.character).where(eq(schema.character.id, made.characterIds[0]!))
	expect(copy!.ownerId).toBe(receiver)
	const files = await db.select().from(schema.file).where(inArray(schema.file.blobPath, Object.values(again.paths)))
	expect(files.map(file => file.ownerId)).toEqual([receiver, receiver])
	for (const key of ['f1', 'f2']) {
		expect(again.paths[key]).not.toBe(first.paths[key])
		expect(await bytes(again.paths[key]!)).toEqual(await bytes(first.paths[key]!))
	}
	expect(again.paths.f1).toStartWith(`avatars/${made.characterIds[0]}/`)
	expect(again.paths.f2).toStartWith(`libraries/${made.libraryIds[0]}/`)

	// Asked for, a library that is not the publisher's is not found.
	await expect(takePackage(db, publisher, { libraryIds: [shared!.id] })).rejects.toThrow('Library not found')
})

test('a three-model group package comes out as a folder of the receiver\'s whose defaults name their copies', async () => {
	const { library, places } = await seedLibrary()
	const [engineer, designer, me] = await db.insert(schema.character).values([
		{ ownerId: publisher, name: 'Engineer', color: 'blue', instructions: 'You build things.' },
		{ ownerId: publisher, name: 'Designer', color: 'pink', instructions: 'You design things.' },
		{ ownerId: publisher, name: 'Me', instructions: 'I am the user.' },
	]).returning()
	const [profile] = await db.insert(schema.modelProfile).values({ ownerId: publisher, name: 'Designer model', color: 'pink', platform: 'deepseek', modelId: 'deepseek-flash', params: { temperature: 0.7 }, characterId: designer!.id }).returning()
	const [group] = await db.insert(schema.structureProfile).values({ ownerId: publisher, name: 'Group', blocks: [{ id: 'b1', kind: 'participants' }, { id: 'b2', kind: 'history' }] }).returning()
	const [team] = await db.insert(schema.contentPackage).values({
		ownerId: publisher,
		name: 'Full-stack Dev Team',
		items: { characterIds: [], libraryIds: [], structureProfileIds: [] },
		texts: { summary: '', description: '', tags: [], category: null },
		setup: {
			libraryIds: [library.id],
			structureProfileId: group!.id,
			mode: 'group',
			userCharacterId: me!.id,
			models: [
				{ characterId: engineer!.id, modelId: 'deepseek-pro', params: { temperature: 0.2 } },
				{ profileId: profile!.id, name: 'Design' },
				{ name: 'Reviewer', color: 'amber', modelId: null, systemPrompt: 'Review it.', params: {} },
			],
			settings: { webSearch: true, autoFetch: { enabled: true, folders: [places.id] } },
		},
	}).returning()

	const first = await takePackage(db, publisher, { packageId: team!.id })
	expect(first.left).toEqual([])
	expect(first.content.characters.map(character => character.name)).toEqual(['Engineer', 'Designer', 'Me'])
	expect(first.content.setup).toEqual({
		models: [
			{ characterKey: 'c1', modelId: 'deepseek-pro', params: { temperature: 0.2 } },
			// The profile's fields, under the lane's own.
			{ name: 'Design', color: 'pink', modelId: 'deepseek-flash', systemPrompt: null, params: { temperature: 0.7 }, characterKey: 'c2' },
			{ name: 'Reviewer', color: 'amber', modelId: null, systemPrompt: 'Review it.', params: {} },
		],
		mode: 'group',
		libraryKeys: ['l1'],
		structureProfileKey: 'p1',
		userCharacterKey: 'c3',
		settings: { webSearch: true, autoFetch: { enabled: true, folders: ['e1'] } },
	})

	const made = await givePackage(db, store, { userId: receiver, content: first.content, paths: first.paths, folderName: 'Full-stack Dev Team' })
	const [copy] = await db.select().from(schema.chatFolder).where(eq(schema.chatFolder.id, made.folderId!))
	expect(copy!.userId).toBe(receiver)
	expect(copy!.name).toBe('Full-stack Dev Team')
	// Its defaults are valid ones, naming the receiver's copies.
	const defaults = folderDefaultsSchema.parse(copy!.defaults)
	expect(defaults.models!.map(lane => lane.characterId)).toEqual([made.characterIds[0], made.characterIds[1], undefined])
	expect(defaults.userCharacterId).toBe(made.characterIds[2])
	expect(defaults.libraryIds).toEqual(made.libraryIds)
	expect(defaults.structureProfileId).toBe(made.structureProfileIds[0]!)
	const [copiedPlaces] = await db.select().from(schema.libraryEntry).where(eq(schema.libraryEntry.id, defaults.settings!.autoFetch!.folders![0]!))
	expect([copiedPlaces!.name, copiedPlaces!.libraryId]).toEqual(['Places', made.libraryIds[0]!])
	const characters = await db.select().from(schema.character).where(inArray(schema.character.id, made.characterIds))
	expect(characters.every(character => character.ownerId === receiver)).toBe(true)

	// Made into a package again, from the receiver's folder, it holds the same.
	const again = await takePackage(db, receiver, { packageId: (await packageFromFolder(db, receiver, made.folderId!)).id })
	expect(again.content).toEqual(first.content)
})

test('each limit refuses, and so does an empty package', async () => {
	const characters = await db.insert(schema.character).values(Array.from({ length: 13 }, (_, index) => ({ ownerId: publisher, name: `C${index}` }))).returning()
	await expect(takePackage(db, publisher, { characterIds: characters.map(row => row.id) })).rejects.toThrow(expect.objectContaining({ status: 400, message: 'A listing holds at most 12 Characters' }))

	const libraries = await db.insert(schema.library).values(Array.from({ length: 6 }, (_, index) => ({ ownerId: publisher, name: `L${index}` }))).returning()
	await expect(takePackage(db, publisher, { libraryIds: libraries.map(row => row.id) })).rejects.toThrow('A listing holds at most 5 libraries')

	await db.insert(schema.libraryEntry).values(Array.from({ length: 501 }, (_, index) => ({ libraryId: libraries[0]!.id, kind: 'note' as const, name: `N${index}`, content: '' })))
	await expect(takePackage(db, publisher, { libraryIds: [libraries[0]!.id] })).rejects.toThrow('A library in a listing holds at most 500 files, notes and folders')

	const profiles = await db.insert(schema.structureProfile).values(Array.from({ length: 11 }, (_, index) => ({ ownerId: publisher, name: `P${index}`, blocks: [{ id: 'h', kind: 'history' as const }] }))).returning()
	await expect(takePackage(db, publisher, { structureProfileIds: profiles.map(row => row.id) })).rejects.toThrow('A listing holds at most 10 structure profiles')

	// Four files of 7 MB: 28 MB with the files.
	const heavy = libraries[1]!.id
	const files = await db.insert(schema.file).values(Array.from({ length: 4 }, (_, index) => ({ ownerId: publisher, blobPath: `libraries/${heavy}/${index}.pdf`, fileName: `${index}.pdf`, mediaType: 'application/pdf', size: 7 * 1024 * 1024 }))).returning()
	await db.insert(schema.libraryEntry).values(files.map(file => ({ libraryId: heavy, kind: 'file' as const, name: file.fileName!, fileId: file.id })))
	await expect(takePackage(db, publisher, { libraryIds: [heavy] })).rejects.toThrow(expect.objectContaining({ status: 413, message: 'A listing can be at most 25 MB with its files' }))

	await expect(takePackage(db, publisher, {})).rejects.toThrow('There is nothing to publish')
})
