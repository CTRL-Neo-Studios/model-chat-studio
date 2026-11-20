<script setup lang="ts">
import { useChat } from '@ai-sdk/vue'
import { DefaultChatTransport } from 'ai'
import type { UIMessage } from 'ai'

// Readable by guests when link access is on; the server decides who sees what.
definePageMeta({ auth: false })

const route = useRoute()
const toast = useToast()
const { csrf, headerName } = useCsrf()
const chatId = route.params.id as string

const { data } = await useFetch(`/api/v1/chats/${chatId}`, { key: `chat-${chatId}` })

const isOwner = computed(() => data.value?.isOwner ?? false)
const visibility = ref<'public' | 'private'>(data.value?.visibility ?? 'private')
const title = ref<string | null>(data.value?.title ?? null)

useHead({ title: () => title.value || 'Chat' })

const { data: votes } = await useLazyFetch(`/api/v1/chats/${chatId}/votes`, {
	immediate: isOwner.value,
	default: () => [],
})

const input = ref('')

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

const { messages, status, error, sendMessage, regenerate, stop } = useChat({
	id: chatId,
	messages: data.value?.messages as UIMessage[] | undefined,
	transport: new DefaultChatTransport({
		api: `/api/v1/chats/${chatId}`,
		headers: { [headerName]: csrf },
		// The server keeps the history: send only the new message, or what to regenerate.
		prepareSendMessagesRequest: ({ messages, trigger, messageId }) => ({
			body: trigger === 'submit-message'
				? { trigger, message: messages[messages.length - 1] }
				: { trigger, messageId },
		}),
	}),
	async onFinish() {
		// The server names the chat at the end of the first answer.
		if (title.value) return
		await refreshNuxtData('chats')
		const chats = useNuxtData<{ id: string, label: string }[]>('chats')
		const label = chats.data.value?.find(chat => chat.id === chatId)?.label
		if (label && label !== 'Untitled') title.value = label
	},
	onError(error) {
		toast.add({ description: describeError(error), icon: 'i-lucide-alert-circle', color: 'error', duration: 0 })
	},
})

function handleSubmit(e: Event) {
	e.preventDefault()
	if (!input.value.trim()) return
	sendMessage({ text: input.value })
	input.value = ''
}

const editingMessageId = ref<string | null>(null)

function startEdit(message: UIMessage) {
	if (!editingMessageId.value) editingMessageId.value = message.id
}

// Sending a message under an existing id is an edit: the server replaces it and drops what followed.
function saveEdit(message: UIMessage, text: string) {
	editingMessageId.value = null
	sendMessage({ text, messageId: message.id })
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
	if (isOwner.value && data.value?.messages.length === 1) regenerate()
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
					:chat-id="data.id"
					:visibility="visibility"
					@update:visibility="visibility = $event"
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

						<template #content="{ message, streaming }">
							<ChatMessageContent
								:message="message"
								:streaming="streaming"
								:editing="isOwner && editingMessageId === message.id"
								@save="saveEdit"
								@cancel-edit="editingMessageId = null"
							/>
						</template>

						<template v-if="isOwner" #actions="{ message }">
							<ChatMessageActions
								:message="message"
								:streaming="status === 'streaming' && message.id === messages[messages.length - 1]?.id"
								:editing="editingMessageId === message.id"
								:vote="getVote(message.id)"
								@vote="vote"
								@edit="startEdit"
								@regenerate="message => regenerate({ messageId: message.id })"
							/>
						</template>

						<template v-if="isOwner" #footer>
							<ChatPrompt
								v-model="input"
								:status="status"
								:error="error"
								class="[view-transition-name:chat-prompt] rounded-b-none backdrop-blur-sm"
								@submit="handleSubmit"
								@stop="stop()"
								@reload="regenerate()"
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
