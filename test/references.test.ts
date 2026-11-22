import { expect, test } from 'bun:test'
import type { UIMessage } from 'ai'
import * as schema from '../server/db/schema'
import { expandReferences } from '../server/utils/library/references'
import type { ContextBlock } from '../shared/utils/chat'
import { createTestDb } from './db'

test('"@" references expand where they stand: a note as text, a folder as what is inside it, a file as a file part', async () => {
	const db = await createTestDb()
	const [owner] = await db.insert(schema.user).values({ githubId: 1, username: 'a' }).returning()
	const [library, other] = await db.insert(schema.library).values([{ ownerId: owner!.id, name: 'P' }, { ownerId: owner!.id, name: 'Q' }]).returning()
	const add = async (values: Partial<typeof schema.libraryEntry.$inferInsert> & { name: string, kind: 'folder' | 'file' | 'note' }) =>
		(await db.insert(schema.libraryEntry).values({ libraryId: library!.id, ...values }).returning())[0]!
	const [pdf] = await db.insert(schema.file).values({ blobPath: 'x', fileName: 'brief.pdf', mediaType: 'application/pdf', size: 10 }).returning()

	const docs = await add({ name: 'docs', kind: 'folder' })
	await add({ name: 'brief.pdf', kind: 'file', parentId: docs.id, fileId: pdf!.id })
	const inner = await add({ name: 'inner.md', kind: 'note', parentId: docs.id, content: 'inside' })
	const plan = await add({ name: 'plan.md', kind: 'note', content: 'Ship "it" Monday.' })
	const [elsewhere] = await db.insert(schema.libraryEntry).values({ libraryId: other!.id, name: 'secret.md', kind: 'note', content: 'no' }).returning()

	const reference = (id: string, name: string, kind: 'folder' | 'file' | 'note') => ({ type: 'data-reference' as const, data: { entryId: id, name, kind } })
	const messages = [
		{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Read @plan.md and @docs' }, reference(plan.id, 'plan.md', 'note'), reference(docs.id, 'docs', 'folder'), reference(inner.id, 'docs/inner.md', 'note'), reference(elsewhere!.id, 'secret.md', 'note')] },
		{ id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'ok' }] },
	] as UIMessage[]
	const blocks: ContextBlock[] = [{ kind: 'message', role: 'user', label: 'Message', size: 23, messageId: 'u1' }, { kind: 'message', role: 'assistant', label: 'Answer', size: 2, messageId: 'a1' }]

	const result = await expandReferences(db, library!.id, messages, blocks)
	expect(result.messages[0]!.parts).toEqual([
		{ type: 'text', text: 'Read @plan.md and @docs' },
		{ type: 'text', text: '<file name="plan.md">\nShip "it" Monday.\n</file>' },
		{ type: 'file', url: `/api/v1/files/${pdf!.id}`, mediaType: 'application/pdf', filename: 'docs/brief.pdf' },
		{ type: 'text', text: '<file name="docs/inner.md">\ninside\n</file>' },
		// Named again on its own: sent once. Another library's note: left out, as if deleted.
		{ type: 'text', text: '[Reference "secret.md" left out: it was deleted.]' },
	])
	expect(result.messages[1]).toBe(messages[1]!)
	expect(result.blocks.map(block => `${block.kind}:${block.label}`)).toEqual([
		'message:Message', 'reference:plan.md', 'reference:docs/brief.pdf', 'reference:docs/inner.md', 'message:Answer',
	])

	// A chat without a library brings nothing in.
	expect((await expandReferences(db, null, messages, blocks)).messages[0]!.parts.slice(1).every(part => part.type === 'text' && part.text.includes('left out'))).toBe(true)
})
