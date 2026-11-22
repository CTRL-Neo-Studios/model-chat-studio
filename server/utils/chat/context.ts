import type { UIMessage } from 'ai'
// Relative, not `#shared`, so this module also loads in `bun test`.
import type { ContextBlock } from '../../../shared/utils/chat'
import { DEFAULT_INSTRUCTIONS } from '../../../shared/utils/instructions'

// Added only while web search is on. Without it, DeepSeek sometimes answered that it had no web
// access and did not search (live runs, milestone 1 plan section 10).
const WEB_SEARCH_INSTRUCTIONS = `Web search is on in this chat: you can search the web and read pages.
- Search for recent events and for facts you are not sure of; otherwise answer from what you know.
- Cite the pages you used.`

// Added only in project chats with the file tools: without it a model does not know there are files to look at.
const FILE_TOOLS_INSTRUCTIONS = `This chat belongs to a project with its own notes and files.
- When the user's question may be answered by them, look: list_files shows what there is, search_files finds words in them, read_file reads one.
- Say which files you used.`

interface ContextInput {
	/** The lane's thread up to the message being answered, which is last. */
	thread: UIMessage[]
	/** The lane's own prompt; `null` uses the default instructions. */
	systemPrompt: string | null
	webSearch: boolean
	/** Messages to send after the latest summary; `null` sends them all. */
	memoryLength: number | null
	/** A project chat whose model may use the file tools. */
	fileTools?: boolean
}

const textOf = (message: Pick<UIMessage, 'parts'>) => message.parts.map(part => part.type === 'text' ? part.text : '').join('')

/** An answer with nothing but reasoning carries nothing forward, so it does not count toward the memory length. */
const counts = (message: UIMessage) => message.role !== 'assistant' || message.parts.some(part => part.type === 'text' || part.type === 'file')

/**
 * What one lane's answer is given: the instructions, then its thread from the latest summary on, cut to the memory
 * length. Also returns the blocks of that context, in the order sent, for the turn trace.
 *
 * - A summary (role `system`) is sent as a user message: the AI SDK takes system messages only as instructions.
 * - The cut never starts on an answer: an answer whose question was left out is left out too, so the thread
 *   always opens with a user message. This keeps at most one message fewer than asked.
 */
export function buildContext({ thread, systemPrompt, webSearch, memoryLength, fileTools = false }: ContextInput) {
	const summaryIndex = thread.findLastIndex(message => message.role === 'system')
	const summary = summaryIndex >= 0 ? thread[summaryIndex] : undefined
	let messages = thread.slice(summaryIndex + 1)

	let start = 0
	if (memoryLength !== null) {
		start = messages.length
		for (let counted = 0; start > 0 && counted < memoryLength;) {
			start--
			if (counts(messages[start]!)) counted++
		}
		while (start < messages.length - 1 && messages[start]!.role !== 'user') start++
	}
	const omitted = start
	messages = messages.slice(start)

	const instructions = [systemPrompt ?? DEFAULT_INSTRUCTIONS, webSearch && WEB_SEARCH_INSTRUCTIONS, fileTools && FILE_TOOLS_INSTRUCTIONS].filter(Boolean).join('\n\n')
	const summaryText = summary && `Summary of the conversation so far:\n\n${textOf(summary)}`

	const blocks: ContextBlock[] = [
		{ kind: 'instructions', role: 'system', label: systemPrompt ? 'System prompt' : 'Default instructions', size: instructions.length, text: instructions },
		...(omitted ? [{ kind: 'omitted' as const, role: 'user' as const, label: `${omitted} earlier ${omitted === 1 ? 'message' : 'messages'} left out by memory`, size: 0, count: omitted }] : []),
		...(summary && summaryText ? [{ kind: 'summary' as const, role: 'user' as const, label: 'Summary', size: summaryText.length, text: summaryText, messageId: summary.id }] : []),
		...messages.map((message): ContextBlock => ({
			kind: 'message',
			role: message.role === 'assistant' ? 'assistant' : 'user',
			label: message.role === 'assistant' ? 'Answer' : 'Message',
			size: textOf(message).length,
			messageId: message.id,
		})),
	]

	const sent: UIMessage[] = summary && summaryText
		? [{ id: summary.id, role: 'user', parts: [{ type: 'text', text: summaryText }] }, ...messages]
		: messages
	return { instructions, messages: sent, blocks }
}
