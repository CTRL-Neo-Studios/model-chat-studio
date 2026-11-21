import { DefaultChatTransport, readUIMessageStream, type UIMessage } from 'ai'
import type { MessageMetadata } from '#shared/utils/chat'

/** A message as the chat page holds it: answers know their lane and the user message they answer. */
export type ChatMessage = UIMessage<MessageMetadata> & { chatModelId?: string | null, parentId?: string | null, createdAt?: string | Date }

/** An answer being written, or one that failed before it was saved. Keyed by `<question id>:<lane id>`. */
export interface PendingAnswer {
	status: 'submitted' | 'streaming' | 'error'
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

/**
 * Streams answers lane by lane into one message list. Each lane's answer is its own request; several run at
 * once. An answer replaces that lane's earlier answer to the same question in place, so nothing after it moves.
 * (The AI SDK `Chat` drops later messages on regenerate; see plan section 6, spike A.)
 */
export function useLaneAnswers(chatId: string, messages: Ref<ChatMessage[]>, options: {
	/** After each answer that completes, e.g. to pick up the chat's new title. */
	onAnswered?: () => void
	/** Whether a stopped answer leaves the lane's earlier answer in place (the member's preference). */
	keepPreviousOnStop?: () => boolean
}) {
	const { csrf, headerName } = useCsrf()
	// The server keeps the history: send only the new message, or what to answer again, and the lane.
	const transport = new DefaultChatTransport<UIMessage>({
		api: `/api/v1/chats/${chatId}`,
		headers: { [headerName]: csrf },
		prepareSendMessagesRequest: ({ messages: sent, trigger, messageId, body }) => ({
			body: trigger === 'submit-message'
				? { trigger, message: sent.at(-1), chatModelId: body?.chatModelId }
				: { trigger, messageId, chatModelId: body?.chatModelId },
		}),
	})

	const pending = ref<Record<string, PendingAnswer>>({})
	const busy = computed(() => Object.values(pending.value).some(entry => entry.status !== 'error'))
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

	async function stream(laneId: string, question: ChatMessage, trigger: 'submit-message' | 'regenerate-message') {
		const key = keyOf(question.id, laneId)
		pending.value[key]?.controller.abort()
		const controller = new AbortController()
		pending.value = { ...pending.value, [key]: { status: 'submitted', controller } }
		const previous = answerOf(question.id, laneId)
		let replacing = previous?.id
		try {
			const chunks = await transport.sendMessages({
				trigger,
				chatId,
				messageId: trigger === 'regenerate-message' ? question.id : undefined,
				messages: [question],
				abortSignal: controller.signal,
				body: { chatModelId: laneId },
			})
			for await (const message of readUIMessageStream<UIMessage<MessageMetadata>>({ stream: chunks, terminateOnError: true })) {
				place({ ...message, chatModelId: laneId, parentId: question.id }, question.id, replacing)
				replacing = message.id
				if (pending.value[key]?.status === 'submitted') pending.value = { ...pending.value, [key]: { status: 'streaming', controller } }
			}
			options.onAnswered?.()
		}
		catch (error) {
			if (!controller.signal.aborted) {
				pending.value = { ...pending.value, [key]: { status: 'error', error: describeError(error), controller } }
				return
			}
			// The server keeps the earlier answer in this case too.
			if (previous && replacing !== previous.id && options.keepPreviousOnStop?.()) place(previous, question.id, replacing)
		}
		if (pending.value[key]?.controller === controller) {
			const { [key]: _, ...rest } = pending.value
			pending.value = rest
		}
	}

	/** Adds a user message and asks each lane to answer it. */
	function send(question: ChatMessage, laneIds: string[]) {
		messages.value = [...messages.value, question]
		for (const laneId of laneIds) stream(laneId, question, 'submit-message')
	}

	/** Asks a lane to answer a user message again (or for the first time), replacing its earlier answer. */
	function regenerate(laneId: string, question: ChatMessage) {
		return stream(laneId, question, 'regenerate-message')
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

	return { pending, busy, keyOf, answerOf, send, regenerate, stop, dismiss }
}
