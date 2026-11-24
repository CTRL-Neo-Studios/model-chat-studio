import { expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import * as schema from '../server/db/schema'
import { assertEntryParent, entrySubtree, listEntries, withUniqueName } from '../server/utils/library/libraries'
import { spaceEntries, spaceResolver } from '../shared/utils/librarySpace'
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

test('paths across two libraries: prefixed with the library when there are two; a shared path finds the first, or the named one', () => {
	const libraries = [{ id: 'A', name: 'Specs' }, { id: 'B', name: 'Team notes' }]
	const note = (id: string, name: string, parentId: string | null = null) => ({ id, parentId, kind: 'note', name })
	const space = spaceEntries(libraries, [
		[note('a-notes', 'notes.md'), { id: 'a-docs', parentId: null, kind: 'folder', name: 'docs' }, note('a-plan', 'plan.md', 'a-docs')],
		[note('b-notes', 'NOTES.md'), note('b-only', 'only.md')],
	])
	expect(space.map(entry => entry.path)).toEqual(['Specs/notes.md', 'Specs/docs', 'Specs/docs/plan.md', 'Team notes/NOTES.md', 'Team notes/only.md'])

	const find = spaceResolver(libraries, space)
	expect(find('notes.md')?.id).toBe('a-notes')
	expect(find('/team notes/notes.md/')?.id).toBe('b-notes')
	expect(find('Specs/docs/plan.md')?.id).toBe('a-plan')
	expect(find('docs/plan.md')?.id).toBe('a-plan')
	expect(find('only.md')?.id).toBe('b-only')
	expect(find('Team notes/plan.md')).toBeUndefined()

	// One library: no prefix.
	expect(spaceEntries([libraries[0]!], [[note('x', 'x.md')]]).map(entry => entry.path)).toEqual(['x.md'])
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
