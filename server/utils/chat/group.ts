import type { UIMessage } from 'ai'
// Relative, not `#shared`, so this module also loads in `bun test`.
import type { MessageMetadata } from '../../../shared/utils/chat'

type StoredMessage = UIMessage<MessageMetadata> & { chatModelId?: string | null, parentId?: string | null }

const textOf = (message: Pick<UIMessage, 'parts'>) => message.parts.map(part => part.type === 'text' ? part.text : '').join('')

/** A message as the speaker reads it: starting with its writer's name. Files and "@" references stay. */
function labelled(message: StoredMessage, name: string): UIMessage {
	const first = message.parts.findIndex(part => part.type === 'text')
	const parts = first === -1
		? [{ type: 'text' as const, text: `${name}:` }, ...message.parts]
		: message.parts.map((part, index) => index === first && part.type === 'text' ? { ...part, text: `${name}: ${part.text}` } : part)
	return { id: message.id, role: 'user', parts }
}

/**
 * A group chat's shared thread as one speaker (`laneId`) sees it: every user message and every answer, each round's
 * answers in speaking order (the user message's `speakers`). The speaker's own answers stay its own; the user's
 * messages and the other speakers' answers become user messages that start with the writer's name, the answers as
 * text only (reasoning and tool calls stay with whoever made them). Summaries pass through.
 *
 * With `questionId`, the thread ends at that round, holding the speakers before this one: on a regenerate, those
 * before its place in `speakers`; otherwise every answer given so far. Without, the whole thread (for `/compact`).
 */
export function groupThread(messages: StoredMessage[], { laneId, questionId, userName }: { laneId: string, questionId?: string, userName: string }): UIMessage[] {
	const thread: UIMessage[] = []
	for (const message of messages) {
		if (message.role === 'system') thread.push(message)
		if (message.role !== 'user') continue
		thread.push(labelled(message, userName))

		const speakers = message.metadata?.speakers ?? []
		// Answers of lanes that are not in `speakers` (removed since) come after, in the order written.
		const place = (answer: StoredMessage) => {
			const index = speakers.indexOf(answer.chatModelId ?? '')
			return index === -1 ? speakers.length : index
		}
		const answers = messages
			.filter(answer => answer.role === 'assistant' && answer.parentId === message.id)
			.map((answer, order) => ({ answer, order }))
			.sort((a, b) => place(a.answer) - place(b.answer) || a.order - b.order)
			.map(({ answer }) => answer)
		const own = speakers.indexOf(laneId)
		const seen = message.id === questionId
			? answers.filter(answer => answer.chatModelId !== laneId && (own === -1 || place(answer) < own))
			: answers
		for (const answer of seen) {
			if (answer.chatModelId === laneId) thread.push(answer)
			else if (textOf(answer).trim()) thread.push({ id: answer.id, role: 'user', parts: [{ type: 'text', text: `${answer.metadata?.lane?.name ?? 'Another model'}: ${textOf(answer)}` }] })
		}
		if (message.id === questionId) break
	}
	return thread
}

/** The paragraph that ends a group speaker's instructions: who it is, who else is here, and how to answer. */
export function groupInstructions({ speaker, others, user }: { speaker: string, others: string[], user: string }) {
	const present = others.length ? `Also here: ${others.join(', ')}, and the user, ${user}.` : `The user is ${user}.`
	return `This is a group chat. You are ${speaker}. ${present}
- Messages from the user and from the others start with their name and a colon.
- Answer once, as ${speaker} only. Do not write lines for anyone else, and do not start with your own name.`
}
