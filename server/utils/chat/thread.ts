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

/**
 * For each user message shown that has other branches at its place: every branch's first message, in the order
 * made (`messages` in `listChatMessages` order, every branch).
 */
export function branchesOf<M extends ThreadMessage>(messages: M[], shown: M[]) {
	const users = messages.filter(message => message.role === 'user')
	const branches: Record<string, string[]> = {}
	for (const message of shown) {
		if (message.role !== 'user') continue
		const siblings = users.filter(user => user.parentId === message.parentId)
		if (siblings.length > 1) branches[message.id] = siblings.map(user => user.id)
	}
	return branches
}

/**
 * The end of the branch from `from` on: at each step the branch made last, until a message nothing follows. From
 * `null`, the newest first message's branch. `users` are a chat's user messages in the order made.
 */
export function branchEnd(users: { id: string, parentId: string | null }[], from: string | null) {
	let id = from ?? users.findLast(user => !user.parentId)?.id ?? null
	// Bounded by the number of messages, so a cycle cannot loop.
	for (let step = 0; id && step <= users.length; step++) {
		const next = users.findLast(user => user.parentId === id)
		if (!next) break
		id = next.id
	}
	return id
}