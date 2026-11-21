<script setup lang="ts">
import type { UIMessage } from 'ai'
import { LazyModalConfirm } from '#components'
import type { ChatMessage } from '~/composables/useLaneAnswers'

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

// The member's preferences; until they load, the server's defaults apply.
const { data: me } = await useLazyFetch('/api/v1/users/me', { immediate: isOwner.value })

await useModels().ready
const chatLanes = useChatLanes(data.value ?? undefined)
const { lanes, enabledLanes, settings, laneModel, laneName } = chatLanes
const answeringModels = computed(() => enabledLanes.value.flatMap(lane => laneModel(lane) ?? []))

const input = ref('')
const { uploads, promptFiles, uploading, parts: fileParts, clear: clearFiles } = usePromptUploads(chatId)

// The server names the chat at the end of the first answer.
async function refreshTitle() {
	if (title.value) return
	await refreshNuxtData('chats')
	const chats = useNuxtData<{ id: string, label: string }[]>('chats')
	const label = chats.data.value?.find(chat => chat.id === chatId)?.label
	if (label && label !== 'Untitled') title.value = label
}

const messages = shallowRef<ChatMessage[]>((data.value?.messages ?? []) as ChatMessage[])
const answers = useLaneAnswers(chatId, messages, {
	onAnswered: refreshTitle,
	keepPreviousOnStop: () => (me.value?.preferences.stoppedRegenerate ?? 'keep-previous') === 'keep-previous',
})

/** The page as a list: each user message, followed by one entry for its answers. */
const shown = computed(() => messages.value.flatMap((message): ChatMessage[] => message.role === 'user'
	? [message, { id: `answers:${message.id}`, role: 'assistant', parts: [{ type: 'text', text: '' }], parentId: message.id }]
	: []))

/** One answer slot per lane that answered (or is answering) the question, then answers of removed lanes. */
function slotsFor(questionId: string) {
	const given = messages.value.filter(message => message.role === 'assistant' && message.parentId === questionId)
	const slots = lanes.value.flatMap((lane) => {
		const message = given.find(answer => answer.chatModelId === lane.id)
		const pending = answers.pending.value[answers.keyOf(questionId, lane.id)]
		if (!message && !pending) return []
		return [{ key: lane.id, lane, message, pending, label: message?.metadata?.lane ?? { name: laneName(lane), color: lane.color } }]
	})
	const removed = given.filter(answer => !lanes.value.some(lane => lane.id === answer.chatModelId)).map(message => ({
		key: message.id, lane: undefined, message, pending: undefined, label: message.metadata?.lane ?? { name: message.metadata?.model ?? 'Removed model', color: null },
	}))
	return [...slots, ...removed]
}
// Cards once more than one model answers; a single model's answer reads as before.
const cards = (questionId: string) => lanes.value.length > 1 || slotsFor(questionId).length > 1
const question = (id: string) => messages.value.find(message => message.id === id)!

function handleSubmit(e: Event) {
	e.preventDefault()
	const text = input.value
	const files = fileParts.value
	if ((!text.trim() && !files.length) || uploading.value || answers.busy.value) return
	if (!enabledLanes.value.length) {
		toast.add({ description: 'Turn on a model first', icon: 'i-lucide-alert-circle', color: 'warning' })
		return
	}
	input.value = ''
	clearFiles()
	const parts = [...(text.trim() ? [{ type: 'text' as const, text }] : []), ...files]
	answers.send({ id: crypto.randomUUID(), role: 'user', parts }, enabledLanes.value.map(lane => lane.id))
}

const editingMessageId = ref<string | null>(null)

function startEdit(message: UIMessage) {
	if (!editingMessageId.value) editingMessageId.value = message.id
}

/** Replaces a message's text. "Save and resend" also drops what followed and has every model answer again. */
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
	if (resend) for (const lane of enabledLanes.value) answers.regenerate(lane.id, question(message.id))
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

// A chat created on the home page arrives with only its first message: every model answers it.
onMounted(() => {
	const [first] = messages.value
	if (isOwner.value && messages.value.length === 1 && first) {
		for (const lane of enabledLanes.value) answers.regenerate(lane.id, first)
	}
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
					<ChatModelsMenu v-if="isOwner" :chat-lanes="chatLanes" />
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
						:messages="shown"
						:status="answers.busy.value ? 'streaming' : 'ready'"
						:class="['pt-(--ui-header-height)', !isOwner && 'pb-4 sm:pb-6']"
						:ui="{ footer: 'pt-4 sm:pt-6' }"
					>
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

						<template #content="{ message }">
							<div
								v-if="message.id.startsWith('answers:')"
								:class="settings.answerLayout === 'stack' || !cards(message.id.slice(8)) ? 'flex flex-col gap-3' : 'flex gap-3 overflow-x-auto pb-2'"
							>
								<ChatAnswer
									v-for="slot in slotsFor(message.id.slice(8))"
									:key="slot.key"
									:label="slot.label"
									:message="slot.message"
									:pending="slot.pending"
									:card="cards(message.id.slice(8))"
									:is-owner="isOwner"
									:editing="!!slot.message && editingMessageId === slot.message.id"
									:vote="slot.message ? getVote(slot.message.id) : null"
									:regenerable="!!slot.lane"
									:class="settings.answerLayout !== 'stack' && cards(message.id.slice(8)) ? 'min-w-80 flex-1 basis-0' : undefined"
									@regenerate="slot.lane && answers.regenerate(slot.lane.id, question(message.id.slice(8)))"
									@stop="slot.lane && answers.stop(message.id.slice(8), slot.lane.id)"
									@dismiss="slot.lane && answers.dismiss(message.id.slice(8), slot.lane.id)"
									@edit="startEdit"
									@delete="deleteMessage"
									@vote="vote"
									@save="saveEdit"
									@cancel-edit="editingMessageId = null"
								/>
							</div>
							<ChatMessageContent
								v-else
								:message="message"
								:streaming="false"
								:editing="isOwner && editingMessageId === message.id"
								@save="saveEdit"
								@cancel-edit="editingMessageId = null"
							/>
						</template>

						<template v-if="isOwner" #actions="{ message }">
							<ChatMessageActions
								v-if="message.role === 'user'"
								:message="message"
								:streaming="false"
								:editing="editingMessageId === message.id"
								:vote="null"
								@edit="startEdit"
								@delete="deleteMessage"
							/>
						</template>

						<template v-if="isOwner" #footer>
							<ChatPrompt
								v-model="input"
								v-model:files="promptFiles"
								:web-search="settings.webSearch"
								:models="answeringModels"
								:uploads="uploads"
								:uploading="uploading"
								:status="answers.busy.value ? 'streaming' : 'ready'"
								class="[view-transition-name:chat-prompt] rounded-b-none backdrop-blur-sm"
								@update:web-search="chatLanes.setSettings({ webSearch: $event })"
								@submit="handleSubmit"
								@stop="answers.stop()"
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
