import { expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import * as schema from '../server/db/schema'
import { assertFolderParent, deleteFolder, listFolders } from '../server/utils/chat/folders'
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
		{ id: drafts!.id, parentId: work!.id, name: 'Drafts', projectId: null },
		{ id: work!.id, parentId: null, name: 'Work', projectId: null },
	])
})
