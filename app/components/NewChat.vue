<script setup lang="ts">
import type { ChatSettings } from '#shared/utils/chat'
import { characterAvatarUrl, fillPlaceholders } from '#shared/utils/character'
import type { PromptCommand } from '~/components/chat/Prompt.vue'

/**
 * The new-chat screen: pick models, write the first message. `temporary` starts a chat that is not kept; `folderId`
 * starts it in that folder. The `heading` slot replaces the greeting; the default slot, the suggestions under the prompt.
 */
const props = defineProps<{
	temporary?: boolean
	folderId?: string
}>()

/** A temporary chat was created; the page shows it in place, without an id in the URL. */
const emit = defineEmits<{ created: [chatId: string] }>()

const input = ref('')
const loading = ref(false)
const chatId = crypto.randomUUID()

const { user } = useUserSession()
const toast = useToast()
const queryCache = useQueryCache()
const { csrf, headerName } = useCsrf()

// Until an admin picks a platform and a key, there is nothing to send to.
const { isPending: modelsPending, platform } = useModels()
const unavailable = computed(() => !modelsPending.value && !platform.value)
const isAdmin = computed(() => user.value?.role === 'admin')

const chatLanes = useChatLanes()
const { lanes, enabledLanes, settings, laneModel, draft, fromProfile } = chatLanes
const answeringModels = computed(() => enabledLanes.value.flatMap(lane => laneModel(lane) ?? []))

// The models and settings of the last chat started, kept as profile or model ids (prompts would not fit a cookie).
const lastLanes = useCookie<{ profileId?: string, modelId?: string | null }[]>('chat-lanes', { default: () => [], sameSite: 'lax' })
const lastSettings = useCookie<ChatSettings>('chat-settings', { default: () => ({}), sameSite: 'lax' })
// Auto-fetch's folders belong to one chat's libraries, so a new chat starts auto-fetch from the defaults.
const { autoFetch: _, ...lastShared } = lastSettings.value
settings.value = { ...lastShared }

const greeting = computed(() => {
	const hour = new Date().getHours()
	const timeGreeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
	const name = user.value?.name?.split(' ')[0] || user.value?.username
	return name ? `${timeGreeting}, ${name}` : timeGreeting
})

// Files upload to the new chat's id before the chat exists; creating it links them to the first message.
const { uploads, promptFiles, uploading, parts: fileParts } = usePromptUploads(chatId)

// What the chat starts with, all removable before the first message: the libraries it reads, its structure profile,
// the answers' mode and who the user is.
const libraryIds = ref<string[]>([])
const structureProfileId = ref<string | null>(null)
// Separate answers, or a group chat where the models share one thread and answer in turn; fixed once the chat starts.
const mode = ref<'separate' | 'group'>('separate')
// Who the user is: their default Character from the settings until they (or the folder) pick another.
const { data: me } = useQuery(meQuery)
const userCharacterChoice = ref<string | null>()
const userCharacterId = computed({
	get: () => userCharacterChoice.value !== undefined ? userCharacterChoice.value : me.value?.preferences.characterId ?? null,
	set: (value: string | null) => userCharacterChoice.value = value,
})

// The greetings the chat will open with, as `POST /chats` writes them (`greetingMessages`): every answering lane's
// Character's first one, in a group only the first lane's, with `{{char}}` and `{{user}}` filled.
const { data: characterList } = useQuery(charactersQuery)
const greetingPreviews = computed(() => {
	const byId = Object.fromEntries((characterList.value ?? []).map(character => [character.id, character]))
	const userName = (userCharacterId.value && byId[userCharacterId.value]?.name) || user.value?.name || user.value?.username || 'you'
	const greeting = enabledLanes.value.flatMap((lane) => {
		const character = lane.characterId ? byId[lane.characterId] : undefined
		return character?.greetings.length
			? [{ laneId: lane.id, name: character.name, color: lane.color ?? character.color, avatar: characterAvatarUrl(character), text: fillPlaceholders(character.greetings[0]!, { char: character.name, user: userName }), more: character.greetings.length - 1 }]
			: []
	})
	return mode.value === 'group' && enabledLanes.value.length >= 2 ? greeting.slice(0, 1) : greeting
})

// "Start a chat" on the profiles page starts from that profile alone. In a folder the chat starts from its defaults
// (or the nearest folder's above), as the server resolves them for this member; a folder without any starts as the
// home page does. Otherwise the last chat's models and settings. Until the profiles (and the folder's start) are here
// the models menu is a placeholder, and sending waits, so a chat does not go out without them.
const { data: profilesData } = useQuery(modelProfilesQuery)
const profileId = useRoute().query.profile
const inFolder = !!props.folderId
const { data: start, refresh: refreshStart } = useQuery(() => ({ ...folderStartQuery(props.folderId ?? ''), enabled: import.meta.client && inFolder }))
// Read afresh, never from the cache: what was cached may predate a change of the defaults or of what they name.
const startRead = ref(!inFolder)
onMounted(() => {
	if (inFolder) refreshStart().finally(() => startRead.value = true)
})
const folder = computed(() => start.value?.folder)
const ready = ref(false)
const stopSetup = watch([profilesData, startRead], ([profiles, read]) => {
	if (ready.value || !profiles || !read) return
	const defaults = start.value?.defaults
	const fromQuery = profiles.find(profile => profile.id === profileId)
	const fromFolder = !fromQuery && start.value?.lanes
	lanes.value = fromFolder
		? fromFolder.map(lane => draft(lane))
		: (fromQuery ? [{ profileId: fromQuery.id }] : lastLanes.value).flatMap((source) => {
				if (!source.profileId) return [draft({ modelId: source.modelId ?? null })]
				const profile = profiles.find(entry => entry.id === source.profileId)
				return profile ? [draft(fromProfile(profile))] : []
			})
	if (!lanes.value.length) lanes.value = [draft({})]
	if (defaults) {
		libraryIds.value = defaults.libraryIds
		structureProfileId.value = defaults.structureProfileId
		if (defaults.settings) settings.value = { ...defaults.settings }
		if (defaults.mode) mode.value = defaults.mode
		if (defaults.userCharacterId !== undefined) userCharacterChoice.value = defaults.userCharacterId
	}
	ready.value = true
	queueMicrotask(() => stopSetup())
}, { immediate: true })

const { data: libraryList } = useQuery(librariesQuery)
const { items: libraryMentions, partsFor } = useLibraryMentions(() => libraryIds.value.flatMap(id => (libraryList.value ?? []).find(library => library.id === id) ?? []))
const references = ref<string[]>([])
// "@" in a group chat names the participants first: picked ones answer the first round, in the order written.
const participants = useParticipantMentions(() => mode.value === 'group' ? enabledLanes.value.map(lane => chatLanes.laneName(lane)) : [])
const mentions = computed(() => [...participants.items.value, ...libraryMentions.value])

async function createChat(prompt: string) {
	// Typing can start at once; sending waits until the models and any folder defaults are in.
	if ((!prompt.trim() && !fileParts.value.length) || uploading.value || loading.value || !ready.value) return
	if (!enabledLanes.value.length) {
		toast.add({ description: 'Turn on a model first', icon: 'i-lucide-alert-circle', color: 'warning' })
		return
	}
	input.value = prompt
	loading.value = true
	try {
		await $fetch('/api/v1/chats', {
			method: 'POST',
			headers: { [headerName]: csrf },
			body: {
				id: chatId,
				message: { id: crypto.randomUUID(), role: 'user', parts: [...(prompt.trim() ? [{ type: 'text', text: prompt }] : []), ...fileParts.value, ...partsFor(references.value), ...(mode.value === 'group' ? participants.partsFor(references.value) : [])] },
				settings: settings.value,
				models: lanes.value.map(({ id: _, position: __, platform: ___, profileId, ...fields }) => ({ ...fields, profileId: profileId ?? undefined })),
				temporary: props.temporary || undefined,
				// Sent as chosen, so a default removed here stays removed.
				libraryIds: libraryIds.value,
				structureProfileId: structureProfileId.value,
				// Left out until changed here, so the server applies the member's default.
				userCharacterId: userCharacterChoice.value,
				folderId: folder.value?.id,
				// A group needs two answering models; with fewer the chat starts as separate answers.
				mode: mode.value === 'group' && enabledLanes.value.length >= 2 ? 'group' : undefined,
			},
		})
	}
	catch {
		loading.value = false
		toast.add({ description: 'Failed to start the chat', icon: 'i-lucide-alert-circle', color: 'error' })
		return
	}
	lastLanes.value = lanes.value.map(lane => lane.profileId ? { profileId: lane.profileId } : { modelId: lane.modelId })
	lastSettings.value = { ...settings.value }
	if (props.temporary) return emit('created', chatId)
	queryCache.invalidateQueries({ key: chatsQuery.key, exact: true })
	// The new chat's models answer its first message once it opens.
	await navigateTo({ path: `/chat/${chatId}`, state: { firstAnswer: true } })
}

// "/temp": the same models and settings, in a temporary chat.
const tempCommand: PromptCommand = { kind: 'temp', label: 'temp', description: 'Make this a temporary chat: not kept, deleted when you leave', icon: 'i-lucide-ghost' }
function startTemporary() {
	lastLanes.value = lanes.value.map(lane => lane.profileId ? { profileId: lane.profileId } : { modelId: lane.modelId })
	lastSettings.value = { ...settings.value }
	return navigateTo('/temporary')
}

const quickChats = [
	{ label: 'Explain a concept simply', icon: 'i-lucide-lightbulb' },
	{ label: 'Help me write a Vue composable', icon: 'i-lucide-code' },
	{ label: 'Summarize the pros and cons of SQL vs NoSQL', icon: 'i-lucide-scale' },
	{ label: 'Show me a chart of sample sales data', icon: 'i-lucide-line-chart' },
]
</script>

<template>
	<UDashboardPanel id="home" class="min-h-0" :ui="{ body: 'p-0 sm:p-0' }">
		<template #header>
			<Navbar>
				<template #title>
					<ChatModelsMenu v-if="!unavailable && ready" v-model:mode="mode" :chat-lanes="chatLanes" choose-mode />
					<USkeleton v-else-if="!unavailable" class="h-8 w-40" aria-label="Loading the models" />
				</template>
			</Navbar>
		</template>

		<template #body>
			<div class="flex flex-1">
				<UContainer :class="['flex-1 flex flex-col gap-4 sm:gap-6', $slots.default ? 'justify-start pt-20 pb-8' : 'justify-center py-8']">
					<slot name="heading">
						<h1 class="text-3xl sm:text-4xl text-highlighted font-bold">
							{{ temporary ? 'Temporary chat' : greeting }}
						</h1>
						<p v-if="temporary" class="text-muted -mt-2">
							Not in your chats, and deleted when you leave or refresh this page. You can keep it once it has started.
						</p>
						<p v-else-if="folder" class="text-muted -mt-2">
							A new chat in “{{ folder.name }}”{{ start?.defaults ? `, starting from ${start.from ? `the defaults of “${start.from.name}”` : 'its defaults'}` : '' }}.
						</p>
					</slot>

					<!-- The chat opens with these: each answering Character's first greeting, in a group only the first one's. -->
					<div v-for="preview in greetingPreviews" :key="preview.laneId" class="flex flex-col gap-1.5 rounded-lg border border-default p-3">
						<div class="flex items-center gap-2">
							<LaneDot :color="preview.color" :avatar="preview.avatar" avatar-class="size-6" />
							<span class="text-sm font-medium text-highlighted">{{ preview.name }}</span>
							<span class="text-xs text-dimmed">opens the chat{{ preview.more ? `; ${preview.more} more ${preview.more === 1 ? 'greeting' : 'greetings'} to flip to` : '' }}</span>
						</div>
						<ChatComark :value="preview.text" :streaming="false" class="text-sm text-muted line-clamp-6" />
					</div>

					<UAlert
						v-if="unavailable"
						color="warning"
						variant="subtle"
						icon="i-lucide-plug-zap"
						title="Chat is not set up yet"
						:description="isAdmin ? 'Choose a model platform and add its API key in the admin settings.' : 'An admin needs to choose a model platform first.'"
						:actions="isAdmin ? [{ label: 'Open settings', to: '/admin/settings', color: 'warning', variant: 'solid' }] : undefined"
					/>

					<ChatPrompt
						v-model="input"
						v-model:files="promptFiles"
						v-model:references="references"
						:mentions="mentions"
						:web-search="settings.webSearch"
						:models="answeringModels"
						:uploads="uploads"
						:uploading="uploading"
						:disabled="loading || unavailable"
						:commands="temporary ? [] : [tempCommand]"
						class="[view-transition-name:chat-prompt]"
						@update:web-search="chatLanes.setSettings({ webSearch: $event })"
						@submit="createChat(input)"
						@command="startTemporary"
					>
						<template #tools>
							<ChatContextSettings v-model:library-ids="libraryIds" v-model:structure-profile-id="structureProfileId" v-model:user-character-id="userCharacterId" :settings="settings" @change="chatLanes.setSettings($event)" />
						</template>
					</ChatPrompt>

					<slot>
						<div class="flex flex-wrap gap-2">
							<UButton
								v-for="quickChat in quickChats"
								:key="quickChat.label"
								:icon="quickChat.icon"
								:label="quickChat.label"
								:disabled="loading || unavailable"
								size="sm"
								color="neutral"
								variant="outline"
								class="rounded-full"
								@click="createChat(quickChat.label)"
							/>
						</div>
					</slot>
				</UContainer>
			</div>
		</template>
	</UDashboardPanel>
</template>
