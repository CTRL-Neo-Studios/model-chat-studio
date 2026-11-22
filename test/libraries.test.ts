import { expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import * as schema from '../server/db/schema'
import { assertEntryParent, entrySubtree, listEntries, withUniqueName } from '../server/utils/library/libraries'
import { createTestDb } from './db'

// docs > specs > draft.md, docs/plan.md, and notes.md at the top
const entries = [
	{ id: 'docs', parentId: null, kind: 'folder' },
	{ id: 'specs', parentId: 'docs', kind: 'folder' },
	{ id: 'draft', parentId: 'specs', kind: 'note' },
	{ id: 'plan', parentId: 'docs', kind: 'file' },
	{ id: 'notes', parentId: null, kind: 'note' },
]

test('an entry moves only into a folder of the library, never into itself or below itself', () => {
	expect(() => assertEntryParent(entries, 'specs', 'docs')).toThrow('itself')
	expect(() => assertEntryParent(entries, 'plan', 'notes')).toThrow('not found')
	expect(() => assertEntryParent(entries, 'elsewhere', 'notes')).toThrow('not found')
	assertEntryParent(entries, 'specs', 'notes')
	assertEntryParent(entries, null, 'draft')
})

test('a folder\'s subtree is everything inside it, and survives a cycle', () => {
	expect(entrySubtree(entries, 'docs').map(entry => entry.id).sort()).toEqual(['docs', 'draft', 'plan', 'specs'])
	expect(entrySubtree(entries, 'notes').map(entry => entry.id)).toEqual(['notes'])
	const cycle = [{ id: 'a', parentId: 'b', kind: 'folder' }, { id: 'b', parentId: 'a', kind: 'folder' }]
	expect(entrySubtree(cycle, 'a').map(entry => entry.id)).toEqual(['a', 'b'])
})

test('names are unique within a folder, the top level included; deleting a folder deletes what is in it', async () => {
	const db = await createTestDb()
	const [owner] = await db.insert(schema.user).values({ githubId: 1, username: 'a' }).returning()
	const [library] = await db.insert(schema.library).values({ ownerId: owner!.id, name: 'P' }).returning()
	const add = (name: string, kind: 'folder' | 'note', parentId: string | null = null) =>
		withUniqueName(db.insert(schema.libraryEntry).values({ libraryId: library!.id, name, kind, parentId }).returning()).then(rows => rows[0]!)

	const docs = await add('docs', 'folder')
	await add('readme.md', 'note')
	await add('readme.md', 'note', docs.id)
	await expect(add('readme.md', 'note')).rejects.toMatchObject({ status: 409 })
	await expect(add('readme.md', 'note', docs.id)).rejects.toMatchObject({ status: 409 })
	await add('Zeta', 'note')
	await add('alpha', 'folder')

	expect((await listEntries(db, library!.id)).filter(entry => entry.parentId === null).map(entry => entry.name))
		.toEqual(['alpha', 'docs', 'readme.md', 'Zeta'])

	await db.delete(schema.libraryEntry).where(eq(schema.libraryEntry.id, docs.id))
	expect((await listEntries(db, library!.id)).map(entry => entry.name)).toEqual(['alpha', 'readme.md', 'Zeta'])
})
