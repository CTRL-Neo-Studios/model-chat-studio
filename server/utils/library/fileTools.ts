import { blob } from '#server/utils/core/blob'
import { schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { tool } from 'ai'
import { z } from 'zod'
import { FILE_UPLOAD } from '#shared/utils/file'
import type { Db } from '#server/utils/core/settings'
import { entrySubtree, listSpace, type SpaceEntry } from './libraries'
import { type LibraryRef, spaceResolver } from '#shared/utils/librarySpace'
import { searchEntryTexts } from './search'
import { fillSearchText } from './searchIndex'

const LIST_LIMIT = 200
const READ_LIMIT = 20_000
const textTypes: readonly string[] = FILE_UPLOAD.textTypes

/**
 * The tools a model gets in a chat with libraries: list, search and read their notes and text files. With more than
 * one library, paths start with the library's name, and `list_files` without a folder lists the libraries. They run
 * with the chat author's access, which the libraries were attached with: the turn route only offers them to whoever
 * may answer in the chat. Problems come back as `{ error }`, so the model can try again or tell the user.
 */
export function fileTools(db: Db, libraries: LibraryRef[]) {
	const ids = libraries.map(library => library.id)
	const several = libraries.length > 1
	const load = async () => {
		const entries = await listSpace(db, libraries)
		return { entries, find: spaceResolver(libraries, entries) }
	}
	const describe = (entry: SpaceEntry) => ({
		path: entry.path,
		kind: entry.kind,
		...(entry.tags.length && { tags: entry.tags }),
		...(entry.kind === 'note' && { characters: entry.noteLength ?? 0 }),
		...(entry.kind === 'file' && { type: entry.mediaType, bytes: entry.size, readable: textTypes.includes(entry.mediaType ?? '') }),
	})
	const listed = (entries: SpaceEntry[]) => {
		const sorted = entries.map(describe).sort((a, b) => a.path.localeCompare(b.path))
		return { entries: sorted.slice(0, LIST_LIMIT), ...(sorted.length > LIST_LIMIT && { more: sorted.length - LIST_LIMIT }) }
	}

	return {
		list_files: tool({
			description: several
				? 'List the libraries attached to this chat, or the folders, notes and files of one library or folder, with their paths, tags and sizes. Paths start with the library\'s name. Notes and text files can be read with read_file; images and PDFs cannot.'
				: 'List the folders, notes and files of the library attached to this chat, with their paths, tags and sizes. Notes and text files can be read with read_file; images and PDFs cannot.',
			inputSchema: z.object({
				folder: z.string().max(2000).optional().describe(several
					? 'A library\'s name, or a folder path such as "Specs/docs"; omit to see the libraries'
					: 'A folder path such as "docs/specs" to list only what is inside it; omit for the whole library'),
			}),
			execute: async ({ folder }) => {
				const { entries, find } = await load()
				const root = folder?.replace(/^\/+|\/+$/g, '')
				if (!root) {
					if (!several) return listed(entries)
					return { libraries: libraries.map(library => ({ path: library.name, entries: entries.filter(entry => entry.libraryId === library.id).length })), hint: 'Call list_files with a library\'s name as the folder.' }
				}
				const library = several ? libraries.find(entry => entry.name.toLowerCase() === root.toLowerCase()) : undefined
				if (library) return listed(entries.filter(entry => entry.libraryId === library.id))
				const inside = find(root)
				if (inside?.kind !== 'folder') return { error: `No folder "${root}". Call list_files without a folder to see what there is.` }
				return listed(entrySubtree(entries, inside.id).filter(entry => entry.id !== inside.id))
			},
		}),

		search_files: tool({
			description: 'Search the text and names of the notes and text files in the chat\'s libraries (not images or PDFs). Any of the words may match; the best matches come first, each with an excerpt (matching words in <b>).',
			inputSchema: z.object({
				query: z.string().min(1).max(500).describe('Words to look for'),
			}),
			execute: async ({ query }) => {
				await fillSearchText(db, ids)
				const [{ entries }, rows] = await Promise.all([load(), searchEntryTexts(db, ids, query, 10)])
				if (!rows.length) return { matches: [], hint: 'Nothing matched. Try other words, or list_files to see the names.' }
				const pathOf: Record<string, string> = Object.fromEntries(entries.map(entry => [entry.id, entry.path]))
				return { matches: rows.map(row => ({ path: pathOf[row.id], excerpt: row.excerpt })) }
			},
		}),

		read_file: tool({
			description: 'Read a note or text file of the chat\'s libraries by its path. Long texts come in parts: read on with the offset given.',
			inputSchema: z.object({
				path: z.string().min(1).max(2000).describe('The path, as list_files or search_files give it'),
				offset: z.number().int().min(0).optional().describe('Character to start from; 0 by default'),
				limit: z.number().int().min(1).max(READ_LIMIT).optional().describe(`Most characters to read; ${READ_LIMIT} by default`),
			}),
			execute: async ({ path, offset = 0, limit = READ_LIMIT }) => {
				const { find } = await load()
				const entry = find(path)
				if (!entry) return { error: `No file "${path}". Use list_files or search_files to find the path.` }
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
				return { path: entry.path, text: part, offset, total: text.length, ...(offset + part.length < text.length && { next: offset + part.length }) }
			},
		}),
	}
}
