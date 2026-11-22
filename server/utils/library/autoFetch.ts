import type { UIMessage } from 'ai'
import { AUTO_FETCH_DEFAULTS, type ChatSettings, type ContextBlock } from '#shared/utils/chat'
import { FILE_UPLOAD } from '#shared/utils/file'
import type { Db } from '#server/utils/core/settings'
import { listEntries } from './libraries'
import { rankEntries, type Scanned, scannedTexts } from './matcher'
import { searchEntryTexts } from './search'
import { fillSearchText } from './searchIndex'
import { expandReferences } from './references'

const AUTO_FETCH_TEXT = 'Files and notes from the library that match this conversation, fetched automatically:'
const textTypes: readonly string[] = FILE_UPLOAD.textTypes

/** Fuzzy auto-fetch: the notes and text files whose text has words of each scanned piece, from the full-text index. */
async function textMatches(db: Db, libraryId: string, scanned: Scanned[]) {
	await fillSearchText(db, libraryId)
	const found = await Promise.all(scanned.map(async piece => (await searchEntryTexts(db, libraryId, piece.text, 20)).map(row => ({ id: row.id, age: piece.age, score: row.rank }))))
	return found.flat()
}

/**
 * Auto-fetch for one answer of a chat with a library: the files and notes that match the lane's latest messages
 * (milestone 4 plan, section 5), as one added user message for the end of the conversation, never stored. `exclude`:
 * entries the context already holds ("@" references). `undefined` when it is off or nothing matches.
 */
export async function autoFetch(db: Db, input: {
	libraryId: string
	settings: ChatSettings['autoFetch']
	thread: UIMessage[]
	systemPrompt: string | null
	exclude: string[]
}) {
	const settings = { ...AUTO_FETCH_DEFAULTS, ...input.settings }
	if (!settings.enabled) return undefined
	const scanned = scannedTexts(input.thread, input.systemPrompt, settings)
	if (!scanned.length) return undefined

	const entries = await listEntries(db, input.libraryId)
	const picked = rankEntries({
		entries: entries.map(entry => ({
			...entry,
			chars: entry.kind === 'note' ? entry.noteLength ?? 0 : textTypes.includes(entry.mediaType ?? '') ? entry.size ?? 0 : 0,
		})),
		scanned,
		settings,
		textMatches: settings.fuzzy ? await textMatches(db, input.libraryId, scanned) : undefined,
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
	const block: ContextBlock = { kind: 'autoFetch', role: 'user', label: 'Fetched from the library', size: AUTO_FETCH_TEXT.length, text: AUTO_FETCH_TEXT, messageId: id }
	const expanded = await expandReferences(db, input.libraryId, [message], [block])
	return {
		message: expanded.messages[0]!,
		blocks: expanded.blocks,
		fetched: expanded.blocks.flatMap(entry => entry.kind === 'reference' && entry.entryId ? [{ entryId: entry.entryId, name: entry.label }] : []),
	}
}
