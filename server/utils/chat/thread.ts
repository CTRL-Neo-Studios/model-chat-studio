interface ThreadMessage { id: string, role: 'user' | 'assistant' | 'system', parentId: string | null }

/**
 * The branch of a chat that ends at `leafId`, from its messages in `listChatMessages` order (every branch, the
 * shown version of each answer): the user messages on the way from the first one to the tip, each with its answers,
 * and the summaries made on that way. Without a tip, or one that is gone, the newest user message is the tip.
 * The rows keep their order, so an answer stays under its question and a summary at its place.
 */
export function shownThread<M extends ThreadMessage>(messages: M[], leafId: string | null): M[] {
	const byId = Object.fromEntries(messages.map(message => [message.id, message]))
	const tip = leafId && byId[leafId]?.role === 'user' ? leafId : messages.findLast(message => message.role === 'user')?.id
	const path: Record<string, true> = {}
	// Bounded by the number of messages, so a cycle cannot loop.
	for (let id = tip, step = 0; id && step <= messages.length; step++) {
		path[id] = true
		id = byId[id]?.parentId ?? undefined
	}
	return messages.filter(message => message.role === 'user'
		? path[message.id]
		: message.role === 'assistant'
			? !!message.parentId && path[message.parentId]
			: !message.parentId || path[message.parentId])
}

/**
 * What a model reads to answer `questionId`: the branch up to and including that message, without what was added
 * after it (its answers, a summary made after it).
 */
export function threadTo<M extends ThreadMessage>(messages: M[], questionId: string): M[] {
	return shownThread(messages, questionId).filter(message => message.role === 'user' || message.parentId !== questionId)
}
