import { inArray } from 'drizzle-orm'
import type { UIMessage } from 'ai'
// Relative, not `hub:db`, so this module also loads in `bun test`.
import * as tables from '../../db/schema'
import type { ContextBlock } from '../../../shared/utils/chat'
import type { Db } from '../core/settings'
import { referencePartSchema } from '../chat/turns'
import { entrySubtree, listSpace, type SpaceEntry } from './libraries'
import type { LibraryRef } from '../../../shared/utils/librarySpace'

type Part = UIMessage['parts'][number]

const quote = (path: string) => path.replace(/"/g, '\'')

/**
 * Expands the "@" references in a chat's messages where they stand: a note becomes its text, a file a file part
 * (`resolveAttachments` then reads it: text files as text, images and PDFs as attachments), and a folder everything
 * inside it. Content is read fresh on every turn. A reference to an entry that is gone, or that is in none of the
 * chat's libraries, leaves a note. Each message's references follow its block in the trace.
 */
export async function expandReferences(db: Db, libraries: LibraryRef[], messages: UIMessage[], blocks: ContextBlock[]) {
	const references = messages.flatMap(message => message.parts.flatMap(part => referencePartSchema.safeParse(part).data ?? []))
	if (!references.length) return { messages, blocks }

	const entries = await listSpace(db, libraries)
	const byId: Record<string, SpaceEntry> = Object.fromEntries(entries.map(entry => [entry.id, entry]))
	/** What a reference brings: the entry, or the files and notes inside a folder; `undefined` when it is gone. */
	const contentsOf = (entryId: string) => byId[entryId] && entrySubtree(entries, entryId).filter(entry => entry.kind !== 'folder')

	const noteIds = references.flatMap(reference => contentsOf(reference.data.entryId) ?? []).filter(entry => entry.kind === 'note').map(entry => entry.id)
	const notes = noteIds.length
		? await db.select({ id: tables.libraryEntry.id, content: tables.libraryEntry.content }).from(tables.libraryEntry).where(inArray(tables.libraryEntry.id, noteIds))
		: []
	const noteText: Record<string, string> = Object.fromEntries(notes.map(note => [note.id, note.content ?? '']))

	const added: Record<string, ContextBlock[]> = {}
	const expanded = messages.map((message) => {
		if (!message.parts.some(part => part.type === 'data-reference')) return message
		const trace: ContextBlock[] = added[message.id] = []
		// An entry named twice, or also inside a named folder, is sent once.
		const sent: Record<string, true> = {}
		const parts = message.parts.flatMap((part): Part[] => {
			const reference = referencePartSchema.safeParse(part).data
			if (!reference) return [part]
			const contents = contentsOf(reference.data.entryId)
			if (!contents) return [{ type: 'text', text: `[Reference "${quote(reference.data.name)}" left out: it was deleted, or its library is no longer attached.]` }]
			return contents.flatMap((entry): Part[] => {
				if (sent[entry.id]) return []
				sent[entry.id] = true
				const path = entry.path
				if (entry.kind === 'note') {
					const text = `<file name="${quote(path)}">\n${noteText[entry.id] ?? ''}\n</file>`
					trace.push({ kind: 'reference', role: 'user', label: path, size: text.length, messageId: message.id, entryId: entry.id })
					return [{ type: 'text', text }]
				}
				trace.push({ kind: 'reference', role: 'user', label: path, size: 0, messageId: message.id, entryId: entry.id })
				return [{ type: 'file', url: `/api/v1/files/${entry.fileId}`, mediaType: entry.mediaType ?? 'application/octet-stream', filename: path }]
			})
		})
		return { ...message, parts }
	})

	return {
		messages: expanded,
		blocks: blocks.flatMap(block => block.messageId && added[block.messageId] ? [block, ...added[block.messageId]!] : [block]),
	}
}
