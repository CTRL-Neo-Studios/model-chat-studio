import { DefaultChatTransport, readUIMessageStream, type UIMessage } from 'ai'
import type { MessageMetadata } from '#shared/utils/chat'

/** A message as the chat page holds it: answers know their lane and the user message they answer; user messages, their sender. */
export type ChatMessage = UIMessage<MessageMetadata> & { chatModelId?: string | null, parentId?: string | null, userId?: string | null, createdAt?: string | Date }

/**
 * An answer being written, waiting for its turn in a group round (`queued`), or one that failed before it was saved.
 * Keyed by `<question id>:<lane id>`.
 */
export interface PendingAnswer {
	status: 'queued' | 'submitted' | 'streaming' | 'error'
	error?: string
	controller: AbortController
}

/** The body of an error response, as the server describes it. */
function describeError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error)
	try {
		const body = JSON.parse(message)
		return body.message || body.statusText || message
	}
	catch {
		return message
	}
}

/** Whether a send was refused because the chat moved on since the page read it (409, milestone 11). */
function movedOn(error: unknown): boolean {
	try {
		const body = JSON.parse(error instanceof Error ? error.message : String(error))
		return (body.status ?? body.statusCode) === 409
	}
	catch {
		return false
	}
}

/**
 * Streams answers lane by lane into one message list. Each lane's answer is its own request; several run at
 * once. An answer is shown in place of that lane's earlier answer to the same question, which the server keeps as
 * a version, so nothing after it moves. (The AI SDK `Chat` drops later messages on regenerate; see plan section 6,
 * spike A.)
 */
export function useLaneAnswers(chatId: string, messages: Ref<ChatMessage[]>, options: {
	/** After each answer that completes, e.g. to pick up the chat's new title. */
	onAnswered?: () => void
	/** Whether a stopped answer leaves the lane's earlier answer in place (the member's preference). */
	keepPreviousOnStop?: () => boolean
	/** Whether lanes answer one after another (a group chat) rather than all at once. */
	inTurn?: () => boolean
	/** A lane's answer was written again: `id` is the newest version of the answer `previousId` was. */
	onVersion?: (previousId: string, id: string) => void
	/** A message was refused because someone else wrote first; it is taken out again, for the page to offer back. */
	onMovedOn?: (question: ChatMessage) => void
}) {
	const { csrf, headerName } = useCsrf()
	// The server keeps the history: send only the new message, or what to answer again, and the lane.
	const transport = new DefaultChatTransport<UIMessage>({
		api: `/api/v1/chats/${chatId}`,
		headers: { [headerName]: csrf },
		prepareSendMessagesRequest: ({ messages: sent, trigger, messageId, body }) => ({
			body: trigger === 'submit-message'
				? { trigger, message: sent.at(-1), chatModelId: body?.chatModelId, after: body?.after }
				: { trigger, messageId, chatModelId: body?.chatModelId },
		}),
	})

	const pending = ref<Record<string, PendingAnswer>>({})
	/** The tip each message sent from this page was written after, by message id. */
	const afters: Record<string, string | null> = {}
	// While a group chat asks who answers the round.
	const deciding = ref(false)
	const busy = computed(() => deciding.value || Object.values(pending.value).some(entry => entry.status !== 'error'))
	const keyOf = (questionId: string, laneId: string) => `${questionId}:${laneId}`

	const answerOf = (questionId: string, laneId: string) =>
		messages.value.find(message => message.role === 'assistant' && message.parentId === questionId && message.chatModelId === laneId)

	/** Puts an answer in place of `replacing`, or after the question's group of answers. */
	function place(answer: ChatMessage, questionId: string, replacing?: string) {
		const list = messages.value
		const at = replacing ? list.findIndex(message => message.id === replacing) : -1
		if (at !== -1) {
			messages.value = list.toSpliced(at, 1, answer)
			return
		}
		let end = list.findIndex(message => message.id === questionId) + 1
		while (list[end]?.role === 'assistant') end++
		messages.value = list.toSpliced(end, 0, answer)
	}

	/** Streams one lane's answer; resolves to whether it completed (not stopped, not failed). */
	async function stream(laneId: string, question: ChatMessage, trigger: 'submit-message' | 'regenerate-message') {
		const key = keyOf(question.id, laneId)
		pending.value[key]?.controller.abort()
		const controller = new AbortController()
		pending.value = { ...pending.value, [key]: { status: 'submitted', controller } }
		const previous = answerOf(question.id, laneId)
		let replacing = previous?.id
		let parts = 0
		// A new answer to a question the lane had answered is that answer's newest version, as the server saves it.
		const versioned = () => previous && replacing && replacing !== previous.id && parts > 0 && options.onVersion?.(previous.id, replacing)
		try {
			const chunks = await transport.sendMessages({
				trigger,
				chatId,
				messageId: trigger === 'regenerate-message' ? question.id : undefined,
				messages: [question],
				abortSignal: controller.signal,
				body: { chatModelId: laneId, ...(trigger === 'submit-message' && question.id in afters && { after: afters[question.id] }) },
			})
			for await (const message of readUIMessageStream<UIMessage<MessageMetadata>>({ stream: chunks, terminateOnError: true })) {
				place({ ...message, chatModelId: laneId, parentId: question.id }, question.id, replacing)
				replacing = message.id
				parts = message.parts.length
				if (pending.value[key]?.status === 'submitted') pending.value = { ...pending.value, [key]: { status: 'streaming', controller } }
			}
			versioned()
			options.onAnswered?.()
		}
		catch (error) {
			if (!controller.signal.aborted) {
				if (trigger === 'submit-message' && movedOn(error)) {
					// Every lane's request is refused alike: the first takes the message out and hands it back.
					const { [key]: _, ...rest } = pending.value
					pending.value = rest
					if (messages.value.some(message => message.id === question.id)) {
						messages.value = messages.value.filter(message => message.id !== question.id)
						options.onMovedOn?.(question)
					}
					return false
				}
				pending.value = { ...pending.value, [key]: { status: 'error', error: describeError(error), controller } }
				return false
			}
			// The server keeps the earlier answer in this case too; otherwise it saves what was written as a version.
			if (previous && replacing !== previous.id && options.keepPreviousOnStop?.()) place(previous, question.id, replacing)
			else versioned()
		}
		if (pending.value[key]?.controller === controller) {
			const { [key]: _, ...rest } = pending.value
			pending.value = rest
		}
		return !controller.signal.aborted
	}

	/** Shows a round's order at once, as the server will record it while the speakers answer. */
	function setSpeakers(questionId: string, speakers: string[]) {
		messages.value = messages.value.map(message => message.id === questionId ? { ...message, metadata: { ...message.metadata, speakers } } : message)
	}

	/** Forgets the speakers still waiting for their turn in a round that ended. */
	function clearQueued(questionId: string) {
		pending.value = Object.fromEntries(Object.entries(pending.value).filter(([key, entry]) => !(entry.status === 'queued' && key.startsWith(`${questionId}:`))))
	}

	/**
	 * Asks each lane to answer: all at once, or in a group chat one after another, so each speaker reads the answers
	 * before it; those still waiting show as queued. There a stopped or failed answer ends the round.
	 */
	async function ask(order: string[] | Promise<string[]>, question: ChatMessage, trigger: 'submit-message' | 'regenerate-message') {
		deciding.value = true
		const laneIds = await Promise.resolve(order).finally(() => deciding.value = false)
		if (!options.inTurn?.()) {
			for (const laneId of laneIds) stream(laneId, question, trigger)
			return
		}
		setSpeakers(question.id, laneIds)
		pending.value = { ...pending.value, ...Object.fromEntries(laneIds.map(laneId => [keyOf(question.id, laneId), { status: 'queued' as const, controller: new AbortController() }])) }
		for (const laneId of laneIds) {
			const waiting = pending.value[keyOf(question.id, laneId)]
			if (waiting?.status !== 'queued' || waiting.controller.signal.aborted || !await stream(laneId, question, trigger)) break
		}
		clearQueued(question.id)
	}

	/**
	 * Adds a user message, written after the tip `after` (the last user message the page shows), and asks each lane
	 * to answer it; in a group chat, the lanes chosen for the round, in order.
	 */
	function send(question: ChatMessage, laneIds: string[] | Promise<string[]>, after: string | null) {
		afters[question.id] = after
		messages.value = [...messages.value, question]
		return ask(laneIds, question, 'submit-message')
	}

	/** Asks a lane to answer a user message again (or for the first time); its earlier answer becomes a version. */
	function regenerate(laneId: string, question: ChatMessage) {
		return stream(laneId, question, 'regenerate-message')
	}

	/** Asks each lane to answer a user message again, as `send` does. */
	function regenerateAll(question: ChatMessage, laneIds: string[] | Promise<string[]>) {
		return ask(laneIds, question, 'regenerate-message')
	}

	/** Stops one lane's answer to a question, or every answer being written. */
	function stop(questionId?: string, laneId?: string) {
		for (const [key, entry] of Object.entries(pending.value)) {
			if (!questionId || key === keyOf(questionId, laneId!)) entry.controller.abort()
		}
	}

	/** Forgets a failed answer's error. */
	function dismiss(questionId: string, laneId: string) {
		const { [keyOf(questionId, laneId)]: _, ...rest } = pending.value
		pending.value = rest
	}

	return { pending, busy, keyOf, answerOf, send, regenerate, regenerateAll, stop, dismiss }
}
