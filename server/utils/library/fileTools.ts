import { blob } from 'hub:blob'
import { schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { tool } from 'ai'
import { z } from 'zod'
import { FILE_UPLOAD } from '#shared/utils/file'
import type { Db } from '#server/utils/core/settings'
import { entryPaths, entrySubtree, listEntries } from './libraries'
import { searchEntryTexts } from './search'
import { fillSearchText } from './searchIndex'

const LIST_LIMIT = 200
const READ_LIMIT = 20_000
const textTypes: readonly string[] = FILE_UPLOAD.textTypes

/**
 * The tools a model gets in a chat with a library: list, search and read the library's notes and text files. They
 * run with the chat author's access, which the library was attached with: the turn route only offers them to whoever
 * may answer in the chat. Problems come back as `{ error }`, so the model can try again or tell the user.
 */
export function fileTools(db: Db, libraryId: string) {
	const load = async () => {
		const entries = await listEntries(db, libraryId)
		const paths = entryPaths(entries)
		const byPath = Object.fromEntries(entries.map(entry => [paths[entry.id]!.toLowerCase(), entry]))
		return { entries, paths, byPath }
	}
	const describe = (entry: Awaited<ReturnType<typeof listEntries>>[number], path: string) => ({
		path,
		kind: entry.kind,
		...(entry.tags.length && { tags: entry.tags }),
		...(entry.kind === 'note' && { characters: entry.noteLength ?? 0 }),
		...(entry.kind === 'file' && { type: entry.mediaType, bytes: entry.size, readable: textTypes.includes(entry.mediaType ?? '') }),
	})

	return {
		list_files: tool({
			description: 'List the folders, notes and files of the library attached to this chat, with their paths, tags and sizes. Notes and text files can be read with read_file; images and PDFs cannot.',
			inputSchema: z.object({
				folder: z.string().max(2000).optional().describe('A folder path such as "docs/specs" to list only what is inside it; omit for the whole library'),
			}),
			execute: async ({ folder }) => {
				const { entries, paths, byPath } = await load()
				const root = folder?.replace(/^\/+|\/+$/g, '')
				const inside = root ? byPath[root.toLowerCase()] : undefined
				if (root && inside?.kind !== 'folder') return { error: `No folder "${root}" in the library. Call list_files without a folder to see what there is.` }
				const listed = (inside ? entrySubtree(entries, inside.id).filter(entry => entry.id !== inside.id) : entries)
					.map(entry => describe(entry, paths[entry.id]!))
					.sort((a, b) => a.path.localeCompare(b.path))
				return { entries: listed.slice(0, LIST_LIMIT), ...(listed.length > LIST_LIMIT && { more: listed.length - LIST_LIMIT }) }
			},
		}),

		search_files: tool({
			description: 'Search the text and names of the library\'s notes and text files (not images or PDFs). Any of the words may match; the best matches come first, each with an excerpt (matching words in <b>).',
			inputSchema: z.object({
				query: z.string().min(1).max(500).describe('Words to look for'),
			}),
			execute: async ({ query }) => {
				await fillSearchText(db, libraryId)
				const [{ paths }, rows] = await Promise.all([load(), searchEntryTexts(db, libraryId, query, 10)])
				if (!rows.length) return { matches: [], hint: 'Nothing matched. Try other words, or list_files to see the names.' }
				return { matches: rows.map(row => ({ path: paths[row.id], excerpt: row.excerpt })) }
			},
		}),

		read_file: tool({
			description: 'Read a note or text file of the library by its path. Long texts come in parts: read on with the offset given.',
			inputSchema: z.object({
				path: z.string().min(1).max(2000).describe('The path, as list_files or search_files give it'),
				offset: z.number().int().min(0).optional().describe('Character to start from; 0 by default'),
				limit: z.number().int().min(1).max(READ_LIMIT).optional().describe(`Most characters to read; ${READ_LIMIT} by default`),
			}),
			execute: async ({ path, offset = 0, limit = READ_LIMIT }) => {
				const { byPath } = await load()
				const entry = byPath[path.replace(/^\/+/, '').toLowerCase()]
				if (!entry) return { error: `No file "${path}" in the library. Use list_files or search_files to find the path.` }
				if (entry.kind === 'folder') return { error: `"${path}" is a folder. Use list_files with it as the folder.` }
				let text: string
				if (entry.kind === 'note') {
					const [row] = await db.select({ content: schema.libraryEntry.content }).from(schema.libraryEntry).where(eq(schema.libraryEntry.id, entry.id))
					text = row?.content ?? ''
				}
				else {
					if (!textTypes.includes(entry.mediaType ?? '')) return { error: `"${path}" is ${entry.mediaType ?? 'not text'} and cannot be read here. The user can name it with "@" to send it.` }
					const [row] = await db.select({ blobPath: schema.file.blobPath }).from(schema.file).where(eq(schema.file.id, entry.fileId!))
					const stored = row ? await blob.get(row.blobPath) : null
					if (!stored) return { error: `"${path}" is missing from storage.` }
					text = await stored.text()
				}
				const part = text.slice(offset, offset + limit)
				return { path, text: part, offset, total: text.length, ...(offset + part.length < text.length && { next: offset + part.length }) }
			},
		}),
	}
}
