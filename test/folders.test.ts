import { expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import * as schema from '../server/db/schema'
import { assertFolderParent, deleteFolder, listFolders } from '../server/utils/chat/folders'
import { folderStart } from '../server/utils/chat/folderStart'
import { nearestWithDefaults } from '../shared/utils/folderDefaults'
import { createTestDb } from './db'

test('a folder cannot move into itself or a folder inside it, nor into another member\'s folder', () => {
	// work > ideas > drafts, and home at the top
	const folders = [
		{ id: 'work', parentId: null },
		{ id: 'ideas', parentId: 'work' },
		{ id: 'drafts', parentId: 'ideas' },
		{ id: 'home', parentId: null },
	]
	expect(() => assertFolderParent(folders, 'work', 'work')).toThrow('itself')
	expect(() => assertFolderParent(folders, 'drafts', 'work')).toThrow('itself')
	expect(() => assertFolderParent(folders, 'unknown', 'work')).toThrow('not found')
	assertFolderParent(folders, 'home', 'work')
	assertFolderParent(folders, null, 'drafts')
	assertFolderParent(folders, 'drafts', 'home')
})

test('deleting a folder moves its chats and folders up to its parent; another member\'s folder is not touched', async () => {
	const db = await createTestDb()
	const [a, b] = await db.insert(schema.user).values([{ githubId: 1, username: 'a' }, { githubId: 2, username: 'b' }]).returning()
	const [work] = await db.insert(schema.chatFolder).values({ userId: a!.id, name: 'Work' }).returning()
	const [ideas] = await db.insert(schema.chatFolder).values({ userId: a!.id, name: 'Ideas', parentId: work!.id }).returning()
	const [drafts] = await db.insert(schema.chatFolder).values({ userId: a!.id, name: 'Drafts', parentId: ideas!.id }).returning()
	const [chat] = await db.insert(schema.chat).values({ userId: a!.id, folderId: ideas!.id }).returning()

	expect(await deleteFolder(db, b!.id, ideas!.id)).toBe(false)
	expect(await deleteFolder(db, a!.id, ideas!.id)).toBe(true)

	const [moved] = await db.select({ folderId: schema.chat.folderId }).from(schema.chat).where(eq(schema.chat.id, chat!.id))
	expect(moved!.folderId).toBe(work!.id)
	expect(await listFolders(db, a!.id)).toEqual([
		{ id: drafts!.id, parentId: work!.id, name: 'Drafts', defaults: null },
		{ id: work!.id, parentId: null, name: 'Work', defaults: null },
	])
})

test('a new chat takes the defaults of its folder, else of the nearest folder up that has some', () => {
	const work = { libraryIds: ['L1'], structureProfileId: 'P1' }
	const ideas = { libraryIds: [], structureProfileId: null }
	// work (defaults) > ideas (its own, empty) > drafts; work > plans (none); home (none)
	const folders = [
		{ id: 'work', parentId: null, defaults: work },
		{ id: 'ideas', parentId: 'work', defaults: ideas },
		{ id: 'drafts', parentId: 'ideas', defaults: null },
		{ id: 'plans', parentId: 'work', defaults: null },
		{ id: 'home', parentId: null, defaults: null },
	]
	expect(nearestWithDefaults(folders, 'plans')?.defaults).toBe(work)
	expect(nearestWithDefaults(folders, 'drafts')?.id).toBe('ideas')
	expect(nearestWithDefaults(folders, 'home')).toBeNull()
	expect(nearestWithDefaults(folders, null)).toBeNull()
	expect(nearestWithDefaults(folders, 'gone')).toBeNull()
	expect(nearestWithDefaults([{ id: 'a', parentId: 'b', defaults: null }, { id: 'b', parentId: 'a', defaults: null }], 'a')).toBeNull()
})

test('a chat started in a folder gets what of its defaults the member may still use', async () => {
	const db = await createTestDb()
	const [a, b] = await db.insert(schema.user).values([{ githubId: 1, username: 'a' }, { githubId: 2, username: 'b' }]).returning()
	const [mine, theirs] = await db.insert(schema.library).values([{ ownerId: a!.id, name: 'Mine' }, { ownerId: b!.id, name: 'Theirs' }]).returning()
	const [ownProfile, otherProfile] = await db.insert(schema.modelProfile).values([
		{ ownerId: a!.id, name: 'Coder', platform: 'deepseek', modelId: 'm1' },
		{ ownerId: b!.id, name: 'Not mine', platform: 'deepseek', modelId: 'm9' },
	]).returning()
	const [otherCharacter] = await db.insert(schema.character).values({ ownerId: b!.id, name: 'Theirs' }).returning()
	const [structure] = await db.insert(schema.structureProfile).values({ ownerId: b!.id, name: 'Theirs', blocks: [{ id: 'h', kind: 'history' }] }).returning()
	const [work] = await db.insert(schema.chatFolder).values({ userId: a!.id, name: 'Work', defaults: {
		libraryIds: [mine!.id, theirs!.id],
		structureProfileId: structure!.id,
		models: [
			{ profileId: ownProfile!.id, name: 'Mine' },
			// A profile they cannot use: dropped with nothing of its own, kept for its own model otherwise.
			{ profileId: otherProfile!.id },
			{ profileId: otherProfile!.id, modelId: 'm2' },
			{ modelId: 'm3', characterId: otherCharacter!.id },
		],
		mode: 'group',
		userCharacterId: otherCharacter!.id,
		settings: { webSearch: true },
	} }).returning()
	const [ideas] = await db.insert(schema.chatFolder).values({ userId: a!.id, name: 'Ideas', parentId: work!.id }).returning()
	const user = a!

	const start = await folderStart(db, user, ideas!.id)
	expect(start?.folder).toEqual({ id: ideas!.id, name: 'Ideas' })
	expect(start?.from).toEqual({ id: work!.id, name: 'Work' })
	expect(start?.defaults).toEqual({
		libraryIds: [mine!.id],
		structureProfileId: null,
		models: [{ profileId: ownProfile!.id, name: 'Mine' }, { modelId: 'm2' }, { modelId: 'm3', characterId: null }],
		mode: 'group',
		// The unusable Character is left out, so the member's own default applies.
		settings: { webSearch: true },
	})
	// Another member's folder is not theirs to start in.
	expect(await folderStart(db, b!, work!.id)).toBeNull()

	// No lane left: the default model, and no group with one lane.
	await db.update(schema.chatFolder).set({ defaults: { libraryIds: [], structureProfileId: null, models: [{ profileId: otherProfile!.id }], mode: 'group' } }).where(eq(schema.chatFolder.id, work!.id))
	expect((await folderStart(db, user, work!.id))?.defaults).toMatchObject({ models: [{}], mode: 'separate' })
})
