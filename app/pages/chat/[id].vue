<script setup lang="ts">
import { useChat } from '@ai-sdk/vue'
import { DefaultChatTransport, readUIMessageStream } from 'ai'
import type { UIMessage } from 'ai'
import { LazyModalConfirm } from '#components'

// Readable by guests when link access is on; the server decides who sees what.
definePageMeta({ auth: false })

const route = useRoute()
const toast = useToast()
const { csrf, headerName } = useCsrf()
const chatId = route.params.id as string

const { data } = await useFetch(`/api/v1/chats/${chatId}`, { key: `chat-${chatId}` })

const isOwner = computed(() => data.value?.isOwner ?? false)
const visibility = ref<'public' | 'private'>(data.value?.visibility ?? 'private')
const sharedWith = ref(data.value?.sharedWith ?? [])
const title = ref<string | null>(data.value?.title ?? null)

useHead({ title: () => title.value || 'Chat' })

const { data: votes } = await useLazyFetch(`/api/v1/chats/${chatId}/votes`, {
	immediate: isOwner.value,
	default: () => [],
})

await useModels().ready
const { lane, settings, laneId, flush } = useChatSettings(data.value ?? undefined)

const input = ref('')
const { uploads, promptFiles, uploading, parts: fileParts, clear: clearFiles } = usePromptUploads(chatId)

/** The body of an error response, as the server describes it. */
function describeError(error: Error): string {
	try {
		const body = JSON.parse(error.message)
		return body.message || body.statusText || error.message
	}
	catch {
		return error.message
	}
}

// The server keeps the history: send only the new message, or what to regenerate, and the lane that answers.
const transport = new DefaultChatTransport({
	api: `/api/v1/chats/${chatId}`,
	headers: { [headerName]: csrf },
	prepareSendMessagesRequest: ({ messages, trigger, messageId }) => ({
		body: trigger === 'submit-message'
			? { trigger, message: messages[messages.length - 1], chatModelId: laneId }
			: { trigger, messageId, chatModelId: laneId },
	}),
})

// The server names the chat at the end of the first answer.
async function refreshTitle() {
	if (title.value) return
	await refreshNuxtData('chats')
	const chats = useNuxtData<{ id: string, label: string }[]>('chats')
	const label = chats.data.value?.find(chat => chat.id === chatId)?.label
	if (label && label !== 'Untitled') title.value = label
}

const { messages, status, error, sendMessage, stop } = useChat({
	id: chatId,
	messages: data.value?.messages as UIMessage[] | undefined,
	transport,
	onFinish: refreshTitle,
	onError(error) {
		toast.add({ description: describeError(error), icon: 'i-lucide-alert-circle', color: 'error', duration: 0 })
	},
})

/** The answer being regenerated in place, and how to stop it. */
const regenerating = shallowRef<{ id?: string, controller: AbortController } | null>(null)
const busy = computed(() => !!regenerating.value || status.value === 'submitted' || status.value === 'streaming')

// Settings changed just before sending are saved first, so the turn uses them.
async function handleSubmit(e: Event) {
	e.preventDefault()
	const text = input.value
	const files = fileParts.value
	if ((!text.trim() && !files.length) || uploading.value || busy.value) return
	input.value = ''
	clearFiles()
	await flush()
	sendMessage(text.trim() ? { text, files } : { files })
}

/**
 * Answers a message again, in place: the question of `messageId` (an answer or a user message), or the
 * newest user message. Later messages stay; `chat.regenerate()` would drop them on the client.
 */
async function regenerateAnswer(messageId?: string) {
	if (busy.value) return
	await flush()
	const list = messages.value
	const target = messageId ? list.findIndex(message => message.id === messageId) : list.length - 1
	const questionIndex = list.slice(0, target + 1).findLastIndex(message => message.role === 'user')
	const question = list[questionIndex]
	if (!question) return
	// One lane: a question has at most one answer, right after it.
	let replacing = list[questionIndex + 1]?.role === 'assistant' ? list[questionIndex + 1]!.id : undefined
	const controller = new AbortController()
	regenerating.value = { id: replacing, controller }
	try {
		const stream = await transport.sendMessages({
			trigger: 'regenerate-message',
			chatId,
			messageId: messageId ?? question.id,
			messages: list.slice(0, questionIndex + 1),
			abortSignal: controller.signal,
		})
		for await (const answer of readUIMessageStream({ stream, terminateOnError: true })) {
			const current = messages.value
			const at = replacing ? current.findIndex(message => message.id === replacing) : -1
			messages.value = at === -1
				? current.toSpliced(current.findIndex(message => message.id === question.id) + 1, 0, answer)
				: current.toSpliced(at, 1, answer)
			replacing = answer.id
			regenerating.value = { id: answer.id, controller }
		}
		await refreshTitle()
	}
	catch (error) {
		if (!controller.signal.aborted) toast.add({ description: describeError(error as Error), icon: 'i-lucide-alert-circle', color: 'error', duration: 0 })
	}
	finally {
		regenerating.value = null
	}
}

function stopAnswer() {
	if (regenerating.value) regenerating.value.controller.abort()
	else stop()
}

const editingMessageId = ref<string | null>(null)

function startEdit(message: UIMessage) {
	if (!editingMessageId.value) editingMessageId.value = message.id
}

/** Replaces a message's text. "Save and resend" also drops what followed and answers the message again. */
async function saveEdit(message: UIMessage, text: string, resend: boolean) {
	editingMessageId.value = null
	try {
		const updated = await $fetch(`/api/v1/chats/${chatId}/messages/${message.id}`, {
			method: 'PATCH',
			headers: { [headerName]: csrf },
			body: { text, dropAfter: resend || undefined },
		})
		const index = messages.value.findIndex(entry => entry.id === message.id)
		const next = messages.value.map(entry => entry.id === message.id ? { ...entry, parts: updated.parts, metadata: updated.metadata ?? undefined } : entry)
		messages.value = resend ? next.slice(0, index + 1) : next
	}
	catch (error) {
		toast.add({ description: serverMessage(error) ?? 'Failed to save the message', icon: 'i-lucide-alert-circle', color: 'error' })
		return
	}
	if (resend) await regenerateAnswer(message.id)
}

const deleteModal = useOverlay().create(LazyModalConfirm)

async function deleteMessage(message: UIMessage) {
	const confirmed = await deleteModal.open(message.role === 'user'
		? { title: 'Delete message', description: 'This message and its answers will be deleted. This cannot be undone.', color: 'error' }
		: { title: 'Delete response', description: 'This response will be deleted. This cannot be undone.', color: 'error' }).result
	if (!confirmed) return
	try {
		const { ids } = await $fetch(`/api/v1/chats/${chatId}/messages/${message.id}`, { method: 'DELETE', headers: { [headerName]: csrf } })
		messages.value = messages.value.filter(entry => !ids.includes(entry.id))
	}
	catch (error) {
		toast.add({ description: serverMessage(error) ?? 'Failed to delete the message', icon: 'i-lucide-alert-circle', color: 'error' })
	}
}

function getVote(messageId: string) {
	const vote = votes.value.find(v => v.messageId === messageId)
	return vote ? vote.isUpvoted : null
}

async function vote(message: UIMessage, isUpvoted: boolean) {
	const snapshot = votes.value
	const next = getVote(message.id) === isUpvoted ? null : isUpvoted

	votes.value = [
		...votes.value.filter(v => v.messageId !== message.id),
		...(next === null ? [] : [{ chatId, messageId: message.id, isUpvoted: next }]),
	]
	try {
		await $fetch(`/api/v1/chats/${chatId}/votes`, {
			method: 'POST',
			headers: { [headerName]: csrf },
			body: next === null ? { messageId: message.id } : { messageId: message.id, isUpvoted: next },
		})
	}
	catch {
		votes.value = snapshot
		toast.add({ description: 'Failed to save vote', icon: 'i-lucide-alert-circle', color: 'error' })
	}
}

// A chat created on the home page arrives with only its first message.
onMounted(() => {
	if (isOwner.value && data.value?.messages.length === 1) regenerateAnswer()
})
</script>

<template>
	<UDashboardPanel
		v-if="data?.id"
		id="chat"
		class="relative min-h-0"
		:ui="{ body: 'p-0 sm:p-0 overscroll-none scroll-pt-(--ui-header-height)' }"
	>
		<template #header>
			<Navbar>
				<template #title>
					<ChatTitle
						:chat-id="data.id"
						:title="title"
						:is-owner="isOwner"
						@update:title="title = $event"
					/>
				</template>

				<ChatVisibility
					v-if="isOwner"
					v-model:visibility="visibility"
					v-model:shared-with="sharedWith"
					:chat-id="data.id"
				/>
			</Navbar>
		</template>

		<template #body>
			<div class="flex flex-1">
				<UContainer class="flex-1 flex flex-col gap-4 sm:gap-6">
					<UChatMessages
						should-auto-scroll
						:messages="messages"
						:status="status"
						:class="['pt-(--ui-header-height)', !isOwner && 'pb-4 sm:pb-6']"
						:ui="{ footer: 'pt-4 sm:pt-6' }"
					>
						<template #indicator>
							<div class="flex items-center gap-1.5">
								<ChatIndicator />
								<UChatShimmer text="Thinking..." class="text-sm" />
							</div>
						</template>

						<template #files="{ message, parts }">
							<UChatAttachment
								v-for="(part, index) in parts"
								:key="`${message.id}-${index}`"
								:name="part.filename ?? 'file'"
								:type="part.mediaType"
								:url="part.url"
								:icon="getFileIcon(part.mediaType)"
							/>
						</template>

						<template #content="{ message, streaming }">
							<ChatMessageContent
								:message="message"
								:streaming="streaming || message.id === regenerating?.id"
								:editing="isOwner && editingMessageId === message.id"
								@save="saveEdit"
								@cancel-edit="editingMessageId = null"
							/>
						</template>

						<template v-if="isOwner" #actions="{ message }">
							<ChatMessageActions
								:message="message"
								:streaming="(status === 'streaming' && message.id === messages[messages.length - 1]?.id) || message.id === regenerating?.id"
								:editing="editingMessageId === message.id"
								:vote="getVote(message.id)"
								@vote="vote"
								@edit="startEdit"
								@regenerate="message => regenerateAnswer(message.id)"
								@delete="deleteMessage"
							/>
						</template>

						<template v-if="isOwner" #footer>
							<ChatPrompt
								v-model="input"
								v-model:lane="lane"
								v-model:settings="settings"
								v-model:files="promptFiles"
								:uploads="uploads"
								:uploading="uploading"
								:status="regenerating ? 'streaming' : status"
								:error="error"
								class="[view-transition-name:chat-prompt] rounded-b-none backdrop-blur-sm"
								@submit="handleSubmit"
								@stop="stopAnswer"
								@reload="regenerateAnswer()"
							/>
						</template>
					</UChatMessages>
				</UContainer>
			</div>
		</template>
	</UDashboardPanel>

	<UContainer v-else class="flex-1 flex flex-col gap-4 sm:gap-6">
		<UError :error="{ statusMessage: 'Chat not found', statusCode: 404 }" class="min-h-full" />
	</UContainer>
</template>
