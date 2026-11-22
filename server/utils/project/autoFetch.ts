import { blob } from 'hub:blob'
import { schema } from 'hub:db'
import { inArray } from 'drizzle-orm'
import type { UIMessage } from 'ai'
import { AUTO_FETCH_DEFAULTS, type ChatSettings, type ContextBlock } from '#shared/utils/chat'
import { FILE_UPLOAD } from '#shared/utils/file'
import type { Db } from '#server/utils/core/settings'
import { listEntries } from './projects'
import { rankEntries, scannedTexts } from './matcher'
import { expandReferences } from './references'

/** Fuzzy search reads at most this much of each note and text file. */
const FUZZY_TEXT_CAP = 20_000
const AUTO_FETCH_TEXT = 'Files and notes from the project that match this conversation, fetched automatically:'
const textTypes: readonly string[] = FILE_UPLOAD.textTypes

/** The text of notes and text files, for fuzzy search; capped per file (plan section 7). */
async function searchableTexts(db: Db, entries: Awaited<ReturnType<typeof listEntries>>) {
	const notes = entries.filter(entry => entry.kind === 'note').map(entry => entry.id)
	const files = entries.filter(entry => entry.kind === 'file' && textTypes.includes(entry.mediaType ?? '') && entry.fileId)
	const [noteRows, fileRows] = await Promise.all([
		notes.length ? db.select({ id: schema.projectEntry.id, content: schema.projectEntry.content }).from(schema.projectEntry).where(inArray(schema.projectEntry.id, notes)) : [],
		files.length ? db.select({ id: schema.file.id, blobPath: schema.file.blobPath }).from(schema.file).where(inArray(schema.file.id, files.map(entry => entry.fileId!))) : [],
	])
	const blobPathOf: Record<string, string> = Object.fromEntries(fileRows.map(row => [row.id, row.blobPath]))
	const texts: Record<string, string> = Object.fromEntries(noteRows.map(row => [row.id, (row.content ?? '').slice(0, FUZZY_TEXT_CAP)]))
	await Promise.all(files.map(async (entry) => {
		const stored = blobPathOf[entry.fileId!] ? await blob.get(blobPathOf[entry.fileId!]!) : null
		if (stored) texts[entry.id] = (await stored.text()).slice(0, FUZZY_TEXT_CAP)
	}))
	return texts
}

/**
 * Auto-fetch for one answer of a project chat: the files and notes that match the lane's latest messages (plan
 * section 5), as one added user message for the end of the conversation, never stored. `exclude`: entries the
 * context already holds ("@" references). `undefined` when it is off or nothing matches.
 */
export async function autoFetch(db: Db, input: {
	projectId: string
	settings: ChatSettings['autoFetch']
	thread: UIMessage[]
	systemPrompt: string | null
	exclude: string[]
}) {
	const settings = { ...AUTO_FETCH_DEFAULTS, ...input.settings }
	if (!settings.enabled) return undefined
	const scanned = scannedTexts(input.thread, input.systemPrompt, settings)
	if (!scanned.length) return undefined

	const entries = await listEntries(db, input.projectId)
	const picked = rankEntries({
		entries: entries.map(entry => ({
			...entry,
			chars: entry.kind === 'note' ? entry.noteLength ?? 0 : textTypes.includes(entry.mediaType ?? '') ? entry.size ?? 0 : 0,
		})),
		scanned,
		settings,
		texts: settings.fuzzy ? await searchableTexts(db, entries) : undefined,
		exclude: input.exclude,
	})
	if (!picked.length) return undefined

	// The picks become references, so they reach the model as "@" ones do: notes as text, files as attachments.
	const id = `auto-fetch-${crypto.randomUUID()}`
	const message: UIMessage = {
		id,
		role: 'user',
		parts: [
			{ type: 'text', text: AUTO_FETCH_TEXT },
			...picked.map(entry => ({ type: 'data-reference' as const, data: { entryId: entry.id, name: entry.name, kind: entry.kind } })),
		],
	}
	const block: ContextBlock = { kind: 'autoFetch', role: 'user', label: 'Fetched from the project', size: AUTO_FETCH_TEXT.length, text: AUTO_FETCH_TEXT, messageId: id }
	const expanded = await expandReferences(db, input.projectId, [message], [block])
	return {
		message: expanded.messages[0]!,
		blocks: expanded.blocks,
		fetched: expanded.blocks.flatMap(entry => entry.kind === 'reference' && entry.entryId ? [{ entryId: entry.entryId, name: entry.label }] : []),
	}
}
