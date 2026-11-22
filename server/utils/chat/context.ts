import type { UIMessage } from 'ai'
// Relative, not `#shared`, so this module also loads in `bun test`.
import type { ContextBlock } from '../../../shared/utils/chat'
import type { ProfileBlock } from '../../../shared/utils/structureProfile'
import { DEFAULT_INSTRUCTIONS } from '../../../shared/utils/instructions'

// Added only while web search is on. Without it, DeepSeek sometimes answered that it had no web
// access and did not search (live runs, milestone 1 plan section 10).
const WEB_SEARCH_INSTRUCTIONS = `Web search is on in this chat: you can search the web and read pages.
- Search for recent events and for facts you are not sure of; otherwise answer from what you know.
- Cite the pages you used.`

// Added only in chats with a library and the file tools: without it a model does not know there are files to look at.
const FILE_TOOLS_INSTRUCTIONS = `This chat has libraries of notes and files attached.
- When the user's question may be answered by them, look: list_files shows what there is, search_files finds words in them, read_file reads one.
- Say which files you used.`

interface ContextInput {
	/** The lane's thread up to the message being answered, which is last. */
	thread: UIMessage[]
	/** The lane's own prompt, or its Character's instructions; `null` uses the default instructions. */
	systemPrompt: string | null
	/** How the trace names `systemPrompt`: "System prompt", or the Character's name. */
	promptLabel?: string
	/** Who the user is (their Character), sent after the instructions. */
	aboutUser?: string
	/** A group chat's paragraph (who the speaker is, who else is here), at the very end of the instructions. */
	group?: string
	webSearch: boolean
	/** Messages to send after the latest summary; `null` sends them all. */
	memoryLength: number | null
	/** A chat with a library whose model may use the file tools. */
	fileTools?: boolean
	/** The chat's structure profile: blocks sent around the thread. */
	profile?: ProfileBlock[]
	/** A structure profile's `files` paths, resolved in the chat's library. */
	resolvePath?: (path: string) => { entryId: string, kind: 'folder' | 'file' | 'note' } | undefined
}

const textOf = (message: Pick<UIMessage, 'parts'>) => message.parts.map(part => part.type === 'text' ? part.text : '').join('')

/** An answer with nothing but reasoning carries nothing forward, so it does not count toward the memory length. */
const counts = (message: UIMessage) => message.role !== 'assistant' || message.parts.some(part => part.type === 'text' || part.type === 'file')

const PROFILE_FILES_TEXT = 'Files from the library, as the structure profile includes them:'

/**
 * What one lane's answer is given: the instructions, then its thread from the latest summary on, cut to the memory
 * length. Also returns the blocks of that context, in the order sent, for the turn trace.
 *
 * - A summary (role `system`) is sent as a user message: the AI SDK takes system messages only as instructions.
 * - The cut never starts on an answer: an answer whose question was left out is left out too, so the thread
 *   always opens with a user message. This keeps at most one message fewer than asked.
 * - With a structure profile, its blocks are sent in order around the thread (its `history` block). Its `system`
 *   messages at the very start join the instructions, after the lane's own prompt (they replace the default
 *   instructions when the lane has none); later ones go as user messages. Its `files` blocks name library entries
 *   as references, which `expandReferences` reads; a path the library does not have is left out and named in the
 *   trace. Its `autoFetch` block marks where auto-fetched files go: `autoFetchAt`, and a trace block that says so.
 */
export function buildContext({ thread, systemPrompt, promptLabel = 'System prompt', aboutUser, group, webSearch, memoryLength, fileTools = false, profile, resolvePath }: ContextInput) {
	const summaryIndex = thread.findLastIndex(message => message.role === 'system')
	const summary = summaryIndex >= 0 ? thread[summaryIndex] : undefined
	let kept = thread.slice(summaryIndex + 1)

	let start = 0
	if (memoryLength !== null) {
		start = kept.length
		for (let counted = 0; start > 0 && counted < memoryLength;) {
			start--
			if (counts(kept[start]!)) counted++
		}
		while (start < kept.length - 1 && kept[start]!.role !== 'user') start++
	}
	const omitted = start
	kept = kept.slice(start)
	const summaryText = summary && `Summary of the conversation so far:\n\n${textOf(summary)}`

	const history: { messages: UIMessage[], blocks: ContextBlock[] } = {
		messages: summary && summaryText ? [{ id: summary.id, role: 'user', parts: [{ type: 'text', text: summaryText }] }, ...kept] : kept,
		blocks: [
			...(omitted ? [{ kind: 'omitted' as const, role: 'user' as const, label: `${omitted} earlier ${omitted === 1 ? 'message' : 'messages'} left out by memory`, size: 0, count: omitted }] : []),
			...(summary && summaryText ? [{ kind: 'summary' as const, role: 'user' as const, label: 'Summary', size: summaryText.length, text: summaryText, messageId: summary.id }] : []),
			...kept.map((message): ContextBlock => ({
				kind: 'message',
				role: message.role === 'assistant' ? 'assistant' : 'user',
				label: message.role === 'assistant' ? 'Answer' : 'Message',
				size: textOf(message).length,
				messageId: message.id,
			})),
		],
	}

	const blocks = profile ?? [{ id: 'history', kind: 'history' as const }]
	const leading = blocks.findIndex(block => block.kind !== 'message' || block.role !== 'system')
	const profileSystem = blocks.slice(0, leading === -1 ? blocks.length : leading).flatMap(block => block.kind === 'message' && block.text.trim() ? [block.text] : [])
	const userText = aboutUser?.trim() ? aboutUser.trim() : null
	const instructions = [systemPrompt ?? (profileSystem.length ? null : DEFAULT_INSTRUCTIONS), ...profileSystem, userText, webSearch && WEB_SEARCH_INSTRUCTIONS, fileTools && FILE_TOOLS_INSTRUCTIONS, group].filter(Boolean).join('\n\n')
	const instructionsLabel = [systemPrompt ? promptLabel : profileSystem.length ? '' : 'Default instructions', profileSystem.length ? 'structure profile' : '', userText ? 'your Character' : '', group ? 'group chat' : ''].filter(Boolean).join(' + ')

	const sent: UIMessage[] = []
	const trace: ContextBlock[] = [{ kind: 'instructions', role: 'system', label: instructionsLabel.charAt(0).toUpperCase() + instructionsLabel.slice(1), size: instructions.length, text: instructions }]
	let autoFetchAt: number | null = null
	for (const block of blocks.slice(leading === -1 ? blocks.length : leading)) {
		if (block.kind === 'history') {
			sent.push(...history.messages)
			trace.push(...history.blocks)
		}
		else if (block.kind === 'autoFetch') {
			autoFetchAt = sent.length
			trace.push({ kind: 'autoFetch', role: 'user', label: 'Auto-fetch: nothing matched', size: 0 })
		}
		else if (block.kind === 'message') {
			if (!block.text.trim()) continue
			const id = `profile-${block.id}`
			const role = block.role === 'assistant' ? 'assistant' : 'user'
			sent.push({ id, role, parts: [{ type: 'text', text: block.text }] })
			trace.push({ kind: 'profile', role, label: `Profile: ${block.role} message`, size: block.text.length, text: block.text, messageId: id })
		}
		else {
			const id = `profile-${block.id}`
			const found = block.paths.map(path => ({ path, entry: resolvePath?.(path) }))
			const missing = found.filter(item => !item.entry).map(item => item.path)
			const references = found.flatMap(({ path, entry }) => entry ? [{ type: 'data-reference' as const, data: { entryId: entry.entryId, name: path, kind: entry.kind } }] : [])
			if (references.length) sent.push({ id, role: 'user', parts: [{ type: 'text', text: PROFILE_FILES_TEXT }, ...references] })
			trace.push({
				kind: 'profile',
				role: 'user',
				label: `Profile: files${missing.length ? ` (not in the library: ${missing.join(', ')})` : ''}`,
				size: references.length ? PROFILE_FILES_TEXT.length : 0,
				text: references.length ? PROFILE_FILES_TEXT : 'None of the paths are in the library.',
				...(references.length && { messageId: id }),
			})
		}
	}
	return { instructions, messages: sent, blocks: trace, autoFetchAt }
}
