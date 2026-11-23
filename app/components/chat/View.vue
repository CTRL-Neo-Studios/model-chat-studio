<script setup lang="ts">
import type { UIMessage } from 'ai'
import { LazyModalConfirm } from '#components'
import type { ChatMessage } from '~/composables/useLaneAnswers'
import type { PromptCommand } from '~/components/chat/Prompt.vue'

/** A loaded chat: the page renders it once the chat's query has data. */
const props = defineProps<{
	chatId: string
	/** The chat was just created with one message: every model answers it on arrival. */
	firstAnswer?: boolean
}>()
/** A temporary chat was kept. */
const emit = defineEmits<{ kept: [] }>()
const chatId = props.chatId

const toast = useToast()
const act = useApiAction()
const queryCache = useQueryCache()
const { csrf, headerName } = useCsrf()

// The page's state starts from the cached chat and is written back to it as it changes.
const { data } = useQuery(chatQuery(chatId))
const isOwner = computed(() => data.value?.isOwner ?? false)
const visibility = ref<'public' | 'private'>(data.value?.visibility ?? 'private')
const sharedWith = ref(data.value?.sharedWith ?? [])
// Renaming writes the cache (`useChatActions`), so the title is read from it.
const title = computed(() => data.value?.title ?? null)
const temporary = computed(() => data.value?.temporary ?? false)
// A group chat: one shared thread, the models answer one after another. Fixed when the chat starts.
const group = computed(() => data.value?.mode === 'group')
// The chat's libraries, in attach order; "@" in the prompt names their files, notes and folders.
const libraries = computed(() => data.value?.libraries ?? [])
// "Add to library" copies into a library, which only its owner and editors change.
const editableLibraries = computed(() => libraries.value.filter(library => library.role === 'owner' || library.role === 'editor'))
const { items: libraryMentions, partsFor } = useLibraryMentions(() => isOwner.value ? libraries.value.filter(library => library.role) : [])
const references = ref<string[]>([])
const { data: libraryList } = useQuery(() => ({ ...librariesQuery, enabled: import.meta.client && isOwner.value }))
/** Attaches and detaches libraries; shown at once, and read again from the server if it refuses one. */
async function setLibraries(ids: string[]) {
	const chat = queryCache.getQueryData(chatQuery(chatId).key)
	if (!chat) return
	const before = chat.libraries
	const next = ids.flatMap(id => before.find(library => library.id === id)
		?? (libraryList.value ?? []).filter(library => library.id === id).map(({ name, role }) => ({ id, name, role })))
	queryCache.setQueryData(chatQuery(chatId).key, { ...chat, libraries: next })
	const done = await Promise.all([
		...ids.filter(id => !before.some(library => library.id === id)).map(id => act(`/api/v1/chats/${chatId}/libraries/${id}`, { method: 'PUT' })),
		...before.filter(library => !ids.includes(library.id)).map(library => act(`/api/v1/chats/${chatId}/libraries/${library.id}`, { method: 'DELETE' })),
	])
	if (done.some(ok => !ok)) queryCache.invalidateQueries({ key: chatQuery(chatId).key })
}
/** The chat's structure profile, or `null` for none; shown at once, undone if the server refuses. */
async function setStructureProfile(structureProfileId: string | null) {
	const chat = queryCache.getQueryData(chatQuery(chatId).key)
	if (!chat) return
	queryCache.setQueryData(chatQuery(chatId).key, { ...chat, structureProfileId })
	if (!await act(`/api/v1/chats/${chatId}`, { method: 'PATCH', body: { structureProfileId } })) queryCache.setQueryData(chatQuery(chatId).key, chat)
}
/** Who the user is in this chat, or `null` for themselves; shown at once, undone if the server refuses. */
async function setUserCharacter(userCharacterId: string | null) {
	const chat = queryCache.getQueryData(chatQuery(chatId).key)
	if (!chat) return
	queryCache.setQueryData(chatQuery(chatId).key, { ...chat, userCharacterId })
	if (!await act(`/api/v1/chats/${chatId}`, { method: 'PATCH', body: { userCharacterId } })) queryCache.setQueryData(chatQuery(chatId).key, chat)
}

const overviewOpen = ref(false)

// "Keep this chat": it joins the chat list, named from its first message.
const keeping = ref(false)
async function keep() {
	keeping.value = true
	const kept = await act<{ title: string | null }>(`/api/v1/chats/${chatId}`, { method: 'PATCH', body: { temporary: false } })
	keeping.value = false
	if (!kept) return
	const chat = queryCache.getQueryData(chatQuery(chatId).key)
	if (chat) queryCache.setQueryData(chatQuery(chatId).key, { ...chat, temporary: false, title: kept.title })
	queryCache.invalidateQueries({ key: chatsQuery.key, exact: true })
	emit('kept')
}

useHead({ title: () => title.value || 'Chat' })

const { data: votesData } = useQuery(() => ({ ...chatVotesQuery(chatId), enabled: import.meta.client && isOwner.value }))
const votes = computed(() => votesData.value ?? [])

// The member's preferences; until they load, the server's defaults apply.
const { data: me } = useQuery(() => ({ ...meQuery, enabled: import.meta.client && isOwner.value }))

const chatLanes = useChatLanes(data.value ?? undefined)
const { lanes, enabledLanes, settings, laneModel, laneName, laneColor } = chatLanes
const answeringModels = computed(() => enabledLanes.value.flatMap(lane => laneModel(lane) ?? []))
// "@" in a group chat names the participants first, then the libraries' files.
const participants = useParticipantMentions(() => group.value ? enabledLanes.value.map(lane => laneName(lane)) : [])
const mentions = computed(() => [...participants.items.value, ...libraryMentions.value])

const input = ref('')
const { uploads, promptFiles, uploading, parts: fileParts, clear: clearFiles } = usePromptUploads(chatId)

// The server names the chat at the end of the first answer.
async function refreshTitle() {
	if (title.value) return
	await queryCache.invalidateQueries({ key: chatsQuery.key, exact: true })
	const named = queryCache.getQueryData(chatsQuery.key)?.find(chat => chat.id === chatId)?.title
	const chat = queryCache.getQueryData(chatQuery(chatId).key)
	if (named && chat) queryCache.setQueryData(chatQuery(chatId).key, { ...chat, title: named })
}

const messages = shallowRef<ChatMessage[]>((data.value?.messages ?? []) as ChatMessage[])
// Every version's id of the answers that have several, keyed by the version shown (owner only).
const versions = shallowRef<Record<string, string[]>>({ ...data.value?.versions })
const answers = useLaneAnswers(chatId, messages, {
	onAnswered: refreshTitle,
	keepPreviousOnStop: () => (me.value?.preferences.stoppedRegenerate ?? 'keep-previous') === 'keep-previous',
	inTurn: () => group.value,
	onVersion: (previousId, id) => {
		const { [previousId]: list, ...rest } = versions.value
		versions.value = { ...rest, [id]: [...(list ?? [previousId]), id] }
	},
})

// The memory slider's range: the longest lane thread after its latest summary, in messages that count. A group
// chat has one thread, every answer in it.
const memoryMax = computed(() => Math.max(1, ...lanes.value.map((lane) => {
	const thread = messages.value.filter(message => message.role === 'user' || ((group.value || message.chatModelId === lane.id)
		&& (message.role === 'system' || message.parts.some(part => part.type === 'text' || part.type === 'file'))))
	return thread.length - (thread.findLastIndex(message => message.role === 'system') + 1)
})))

// The cached chat follows this page, so coming back to it shows it as it is now, without a refetch.
function writeBack() {
	const key = chatQuery(chatId).key
	const chat = queryCache.getQueryData(key)
	if (!chat) return
	queryCache.setQueryData(key, {
		...chat,
		visibility: visibility.value,
		sharedWith: sharedWith.value,
		settings: settings.value,
		models: lanes.value as typeof chat.models,
		messages: messages.value as typeof chat.messages,
		versions: versions.value,
	})
}
watch([messages, versions], writeBack)
watch([visibility, sharedWith, settings, lanes], writeBack, { deep: true })

/**
 * The page as a list: each user message followed by one entry for its answers, and a divider where the chat was
 * compacted, holding that run of summaries (one per lane).
 */
const shown = computed(() => messages.value.flatMap((message, index): ChatMessage[] => {
	if (message.role === 'user') return [message, { id: `answers:${message.id}`, role: 'assistant', parts: [{ type: 'text', text: '' }], parentId: message.id }]
	if (message.role === 'system' && messages.value[index - 1]?.role !== 'system') return [{ id: `summaries:${message.id}`, role: 'assistant', parts: [{ type: 'text', text: '' }] }]
	return []
}))

/** The summaries of one compaction: the run of summary messages starting at `firstId`. */
function summariesFrom(firstId: string) {
	const start = messages.value.findIndex(message => message.id === firstId)
	const end = messages.value.findIndex((message, index) => index > start && message.role !== 'system')
	return messages.value.slice(start, end < 0 ? undefined : end)
}

// "/" commands.
const { renameChat } = useChatActions()
const lastLanes = useCookie<{ profileId?: string, modelId?: string | null }[]>('chat-lanes', { default: () => [], sameSite: 'lax' })
const lastSettings = useCookie<ChatSettings>('chat-settings', { default: () => ({}), sameSite: 'lax' })
const commands: PromptCommand[] = [
	{ kind: 'compact', label: 'compact', description: 'Summarise the chat so far; each model is sent the summary from now on', icon: 'i-lucide-fold-vertical' },
	{ kind: 'clear', label: 'clear', description: 'Start a new chat with the same models and settings', icon: 'i-lucide-eraser' },
	{ kind: 'rename', label: 'rename', description: 'Rename this chat', icon: 'i-lucide-pencil' },
]
const compacting = ref(false)
async function runCommand(kind: PromptCommand['kind']) {
	if (kind === 'rename') return renameChat(chatId, title.value)
	if (kind === 'clear') {
		// The new chat starts from these models: profiles by id, other models by model id, as the home page keeps them.
		lastLanes.value = enabledLanes.value.map(lane => lane.profileId ? { profileId: lane.profileId } : { modelId: lane.modelId })
		lastSettings.value = { ...settings.value, memoryLength: undefined }
		return navigateTo('/')
	}
	if (kind !== 'compact' || compacting.value || answers.busy.value) return
	compacting.value = true
	const result = await act<{ summaries: ChatMessage[], failed: number }>(`/api/v1/chats/${chatId}/compact`, { method: 'POST' })
	compacting.value = false
	if (!result) return
	messages.value = [...messages.value, ...result.summaries]
	toast.add({
		title: result.summaries.length ? 'Chat compacted' : 'Nothing to compact',
		description: result.failed ? `${result.failed} ${result.failed === 1 ? 'model' : 'models'} could not summarise; they still get the full chat.` : undefined,
		icon: 'i-lucide-fold-vertical',
		color: result.failed ? 'warning' : 'success',
	})
}

/**
 * One answer slot per lane that answered (or is answering) the question, then answers of removed lanes. In a group
 * chat, in speaking order: the round's `speakers` (those still waiting included), then answers given since, as they
 * arrived.
 */
function slotsFor(questionId: string) {
	const speakers = group.value ? question(questionId).metadata?.speakers ?? [] : []
	const place = (laneId: string | null | undefined) => {
		const index = speakers.indexOf(laneId ?? '')
		return index === -1 ? speakers.length : index
	}
	const given = messages.value.filter(message => message.role === 'assistant' && message.parentId === questionId)
	const arrived = (laneId: string) => {
		const index = given.findIndex(answer => answer.chatModelId === laneId)
		return index === -1 ? given.length : index
	}
	const byLane = (lane: (typeof lanes.value)[number]) => {
		const message = given.find(answer => answer.chatModelId === lane.id)
		const pending = answers.pending.value[answers.keyOf(questionId, lane.id)]
		return message || pending ? [{ key: lane.id, lane, message, pending, label: message?.metadata?.lane ?? { name: laneName(lane), color: laneColor(lane) } }] : []
	}
	const slots = (group.value ? lanes.value.toSorted((a, b) => place(a.id) - place(b.id) || arrived(a.id) - arrived(b.id)) : lanes.value).flatMap(byLane)
	const ordered = group.value ? given.toSorted((a, b) => place(a.chatModelId) - place(b.chatModelId)) : given
	const removed = ordered.filter(answer => !lanes.value.some(lane => lane.id === answer.chatModelId)).map(message => ({
		key: message.id, lane: undefined, message, pending: undefined, label: message.metadata?.lane ?? { name: message.metadata?.model ?? 'Removed model', color: null },
	}))
	return [...slots, ...removed]
}
// Cards once more than one model answers; a single model's answer reads as before.
const cards = (questionId: string) => lanes.value.length > 1 || slotsFor(questionId).length > 1
const question = (id: string) => messages.value.find(message => message.id === id)!

// "Answer" in a group chat: a lane answers the last message after the others, reading their answers.
const lastQuestion = computed(() => messages.value.findLast(message => message.role === 'user'))
function answerLast(lane: { id: string }) {
	if (lastQuestion.value) answers.regenerate(lane.id, lastQuestion.value)
}

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
	const parts = [...(text.trim() ? [{ type: 'text' as const, text }] : []), ...files, ...partsFor(references.value), ...participants.partsFor(references.value)]
	references.value = []
	answers.send({ id: crypto.randomUUID(), role: 'user', parts }, roundOrder(parts))
}

/** Who answers a group round, in order, as the server chooses; nobody when it cannot be asked. */
async function speakersFor(parts: UIMessage['parts']) {
	try {
		return (await $fetch(`/api/v1/chats/${chatId}/speakers`, { method: 'POST', headers: { [headerName]: csrf }, body: speakersQuestion(parts) })).speakers
	}
	catch (error) {
		toast.add({ description: serverMessage(error) ?? 'Could not choose who answers', icon: 'i-lucide-alert-circle', color: 'error' })
		return []
	}
}
/** A round's lanes: in a group chat those the server chooses, else every model that is on. */
const roundOrder = (parts: UIMessage['parts']) => group.value ? speakersFor(parts) : enabledLanes.value.map(lane => lane.id)

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
	if (resend) answers.regenerateAll(question(message.id), roundOrder(question(message.id).parts))
}

const deleteModal = useOverlay().create(LazyModalConfirm)

async function deleteMessage(message: UIMessage) {
	const confirmed = await deleteModal.open(message.role === 'user'
		? { title: 'Delete message', description: 'This message and its answers will be deleted. This cannot be undone.', color: 'error' }
		: versions.value[message.id]
			? { title: 'Delete this version', description: 'This version of the response will be deleted; the newest one left is shown. This cannot be undone.', color: 'error' }
			: { title: 'Delete response', description: 'This response will be deleted. This cannot be undone.', color: 'error' }).result
	if (!confirmed) return
	try {
		const { ids, shown } = await $fetch(`/api/v1/chats/${chatId}/messages/${message.id}`, { method: 'DELETE', headers: { [headerName]: csrf } })
		// A deleted version gives its place to the version shown now.
		messages.value = messages.value.flatMap(entry => entry.id === message.id && shown ? [shown as ChatMessage] : ids.includes(entry.id) ? [] : [entry])
		const { [message.id]: list, ...rest } = versions.value
		const left = list?.filter(id => !ids.includes(id)) ?? []
		versions.value = shown && left.length > 1 ? { ...rest, [shown.id]: left } : rest
	}
	catch (error) {
		toast.add({ description: serverMessage(error) ?? 'Failed to delete the message', icon: 'i-lucide-alert-circle', color: 'error' })
	}
}

/** Shows another version of an answer in its place; the models read that version from then on. */
async function showVersion(answer: ChatMessage, id: string) {
	if (answers.busy.value) return
	const shown = await act<ChatMessage>(`/api/v1/chats/${chatId}/messages/${id}`, { method: 'PATCH', body: { active: true } })
	if (!shown) return
	messages.value = messages.value.map(entry => entry.id === answer.id ? shown : entry)
	const { [answer.id]: list, ...rest } = versions.value
	if (list) versions.value = { ...rest, [shown.id]: list }
}

function getVote(messageId: string) {
	const vote = votes.value.find(v => v.messageId === messageId)
	return vote ? vote.isUpvoted : null
}

async function vote(message: UIMessage, isUpvoted: boolean) {
	const key = chatVotesQuery(chatId).key
	const snapshot = votes.value
	const next = getVote(message.id) === isUpvoted ? null : isUpvoted

	queryCache.setQueryData(key, [
		...snapshot.filter(v => v.messageId !== message.id),
		...(next === null ? [] : [{ chatId, messageId: message.id, isUpvoted: next }]),
	])
	try {
		await $fetch(`/api/v1/chats/${chatId}/votes`, {
			method: 'POST',
			headers: { [headerName]: csrf },
			body: next === null ? { messageId: message.id } : { messageId: message.id, isUpvoted: next },
		})
	}
	catch {
		queryCache.setQueryData(key, snapshot)
		toast.add({ description: 'Failed to save vote', icon: 'i-lucide-alert-circle', color: 'error' })
	}
}

// A chat just created arrives with only its first message: every model answers it. Coming back to it later does
// not, even when its cached copy still has one message.
onMounted(() => {
	const [first] = messages.value
	if (isOwner.value && messages.value.length === 1 && first && props.firstAnswer) {
		answers.regenerateAll(first, roundOrder(first.parts))
	}
})
</script>

<template>
	<UDashboardPanel
		id="chat"
		class="relative min-h-0"
		:ui="{ body: 'p-0 sm:p-0 overscroll-none scroll-pt-(--ui-header-height)' }"
	>
		<template #header>
			<Navbar>
				<template #title>
					<ChatTitle
						:chat-id="chatId"
						:title="title"
						:is-owner="isOwner"
					/>
					<ChatModelsMenu v-if="isOwner" :chat-lanes="chatLanes" :mode="data?.mode" :answer-last="group && lastQuestion && !answers.busy.value ? answerLast : undefined" />
				</template>

				<!-- The chat's libraries: links for people who may open them; labels for someone reading by link or share. -->
				<UButton
					v-for="library in libraries"
					:key="library.id"
					:to="library.role ? `/libraries/${library.id}` : undefined"
					:label="library.name"
					icon="i-lucide-library-big"
					color="neutral"
					variant="subtle"
					size="xs"
					class="max-w-48"
					:class="!library.role && 'pointer-events-none'"
					:ui="{ label: 'truncate' }"
					:aria-label="`Library ${library.name}`"
				/>
				<UTooltip v-if="isOwner" text="Conversation overview">
					<UButton icon="i-lucide-list-tree" color="neutral" variant="ghost" aria-label="Conversation overview" @click="overviewOpen = true" />
				</UTooltip>
				<template v-if="temporary && isOwner">
					<UBadge icon="i-lucide-ghost" label="Temporary" color="neutral" variant="subtle" />
					<UButton label="Keep this chat" icon="i-lucide-bookmark-plus" size="sm" variant="soft" :loading="keeping" @click="keep" />
				</template>
				<ChatVisibility
					v-else-if="isOwner"
					v-model:visibility="visibility"
					v-model:shared-with="sharedWith"
					:chat-id="chatId"
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
								:class="settings.answerLayout === 'stack' || group || !cards(message.id.slice(8)) ? 'flex flex-col gap-3' : 'flex gap-3 overflow-x-auto pb-2'"
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
									:versions="slot.message && versions[slot.message.id]"
									:busy="answers.busy.value"
									:class="settings.answerLayout !== 'stack' && !group && cards(message.id.slice(8)) ? 'min-w-80 flex-1 basis-0' : undefined"
									@regenerate="slot.lane && answers.regenerate(slot.lane.id, question(message.id.slice(8)))"
									@show="id => slot.message && showVersion(slot.message, id)"
									@stop="slot.lane && answers.stop(message.id.slice(8), slot.lane.id)"
									@dismiss="slot.lane && answers.dismiss(message.id.slice(8), slot.lane.id)"
									@edit="startEdit"
									@delete="deleteMessage"
									@vote="vote"
									@save="saveEdit"
									@cancel-edit="editingMessageId = null"
								/>
							</div>
							<div v-else-if="message.id.startsWith('summaries:')" class="flex flex-col gap-2 py-2">
								<USeparator icon="i-lucide-fold-vertical" :label="group ? 'Compacted: every model now gets the summary and what follows' : 'Compacted: each model now gets its summary and what follows'" />
								<UCollapsible v-for="summary in summariesFrom(message.id.slice(10))" :key="summary.id" class="rounded-md border border-default">
									<UButton
										color="neutral"
										variant="ghost"
										block
										trailing-icon="i-lucide-chevron-down"
										:label="group ? 'Summary of the chat' : `Summary for ${summary.metadata?.lane?.name ?? summary.metadata?.model ?? 'a model'}`"
										:ui="{ trailingIcon: 'ms-auto group-data-[state=open]:rotate-180 transition-transform' }"
									/>
									<template #content>
										<p class="px-3 pb-3 text-sm text-muted whitespace-pre-wrap">
											{{ summary.parts.map(part => part.type === 'text' ? part.text : '').join('') }}
										</p>
									</template>
								</UCollapsible>
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
								v-model:references="references"
								:mentions="mentions"
								:web-search="settings.webSearch"
								:models="answeringModels"
								:uploads="uploads"
								:uploading="uploading"
								:status="answers.busy.value ? 'streaming' : 'ready'"
								:disabled="compacting"
								:commands="commands"
								class="[view-transition-name:chat-prompt] rounded-b-none backdrop-blur-sm"
								:memory-max="memoryMax"
								:memory-length="settings.memoryLength"
								@update:web-search="chatLanes.setSettings({ webSearch: $event })"
								@update:memory-length="chatLanes.setSettings({ memoryLength: $event ?? null })"
								@submit="handleSubmit"
								@stop="answers.stop()"
								@command="runCommand"
							>
								<template #tools>
									<ChatContextSettings
										:settings="settings"
										:library-ids="libraries.map(library => library.id)"
										:structure-profile-id="data?.structureProfileId ?? null"
										:user-character-id="data?.userCharacterId ?? null"
										@change="chatLanes.setSettings($event)"
										@update:library-ids="setLibraries"
										@update:structure-profile-id="setStructureProfile"
										@update:user-character-id="setUserCharacter"
									/>
								</template>
							</ChatPrompt>
						</template>
					</UChatMessages>
				</UContainer>
			</div>
		</template>
	</UDashboardPanel>
	<ChatOverview v-if="isOwner" v-model:open="overviewOpen" :chat-id="chatId" :messages="messages" :libraries="editableLibraries" />
</template>
