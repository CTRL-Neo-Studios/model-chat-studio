<script setup lang="ts">
import type { ChatSettings } from '#shared/utils/chat'
import { nearestDefaults } from '#shared/utils/folderDefaults'
import type { PromptCommand } from '~/components/chat/Prompt.vue'

/** The new-chat screen: pick models, write the first message. `temporary` starts a chat that is not kept. */
const props = defineProps<{
	temporary?: boolean
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

// "Start a chat" on the profiles page starts from that profile alone. The lanes start from the profiles, so they
// fill in once the profiles are here (usually cached already); until then the models menu is a placeholder.
const { data: profilesData } = useQuery(modelProfilesQuery)
const profileId = useRoute().query.profile
const lanesReady = ref(false)
const stopLanes = watch(profilesData, (profiles) => {
	if (!profiles || lanesReady.value) return
	const fromQuery = profiles.find(profile => profile.id === profileId)
	lanes.value = (fromQuery ? [{ profileId: fromQuery.id }] : lastLanes.value).flatMap((source) => {
		if (!source.profileId) return [draft({ modelId: source.modelId ?? null })]
		const profile = profiles.find(entry => entry.id === source.profileId)
		return profile ? [draft(fromProfile(profile))] : []
	})
	if (!lanes.value.length) lanes.value = [draft({})]
	lanesReady.value = true
	queueMicrotask(() => stopLanes())
}, { immediate: true })

const greeting = computed(() => {
	const hour = new Date().getHours()
	const timeGreeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
	const name = user.value?.name?.split(' ')[0] || user.value?.username
	return name ? `${timeGreeting}, ${name}` : timeGreeting
})

// Files upload to the new chat's id before the chat exists; creating it links them to the first message.
const { uploads, promptFiles, uploading, parts: fileParts } = usePromptUploads(chatId)

// The libraries the chat will read and its structure profile, chosen before the first message; "@" names their files.
// `?folder=` starts the chat in that folder, with the folder's defaults (or the nearest above) filled in, removable.
const folderParam = props.temporary ? undefined : useRoute().query.folder
const { data: libraryList } = useQuery(librariesQuery)
const { data: folderList } = useQuery(foldersQuery)
const { data: profileList } = useQuery(structureProfilesQuery)
const folder = computed(() => typeof folderParam === 'string' ? folderList.value?.find(entry => entry.id === folderParam) : undefined)
const libraryIds = ref<string[]>([])
const structureProfileId = ref<string | null>(null)
// The defaults fill in once the folders, libraries and profiles are here; sending waits for that, so a chat started
// at once does not go out without them. Libraries left and profiles deleted since the defaults were set are skipped.
const defaultsReady = ref(typeof folderParam !== 'string')
const stopDefaults = watch([folderList, libraryList, profileList], ([folders, libraries, profiles]) => {
	if (defaultsReady.value || !folders || !libraries || !profiles) return
	const defaults = folder.value ? nearestDefaults(folders, folder.value.id) : null
	libraryIds.value = (defaults?.libraryIds ?? []).filter(id => libraries.some(library => library.id === id))
	structureProfileId.value = profiles.find(profile => profile.id === defaults?.structureProfileId)?.id ?? null
	defaultsReady.value = true
	queueMicrotask(() => stopDefaults())
}, { immediate: true })
const ready = computed(() => lanesReady.value && defaultsReady.value)
// Who the user is: their default Character from the settings until they pick another here.
const { data: me } = useQuery(meQuery)
const userCharacterChoice = ref<string | null>()
const userCharacterId = computed({
	get: () => userCharacterChoice.value !== undefined ? userCharacterChoice.value : me.value?.preferences.characterId ?? null,
	set: (value: string | null) => userCharacterChoice.value = value,
})
const { items: mentions, partsFor } = useLibraryMentions(() => libraryIds.value.flatMap(id => (libraryList.value ?? []).find(library => library.id === id) ?? []))
const references = ref<string[]>([])

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
				message: { id: crypto.randomUUID(), role: 'user', parts: [...(prompt.trim() ? [{ type: 'text', text: prompt }] : []), ...fileParts.value, ...partsFor(references.value)] },
				settings: settings.value,
				models: lanes.value.map(({ id: _, position: __, platform: ___, profileId, ...fields }) => ({ ...fields, profileId: profileId ?? undefined })),
				temporary: props.temporary || undefined,
				// Sent as chosen, so a default removed here stays removed.
				libraryIds: libraryIds.value,
				structureProfileId: structureProfileId.value,
				// Left out until changed here, so the server applies the member's default.
				userCharacterId: userCharacterChoice.value,
				folderId: folder.value?.id,
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
					<ChatModelsMenu v-if="!unavailable && lanesReady" :chat-lanes="chatLanes" />
					<USkeleton v-else-if="!unavailable" class="h-8 w-40" aria-label="Loading the models" />
				</template>
			</Navbar>
		</template>

		<template #body>
			<div class="flex flex-1">
				<UContainer class="flex-1 flex flex-col justify-center gap-4 sm:gap-6 py-8">
					<h1 class="text-3xl sm:text-4xl text-highlighted font-bold">
						{{ temporary ? 'Temporary chat' : greeting }}
					</h1>
					<p v-if="temporary" class="text-muted -mt-2">
						Not in your chats, and deleted when you leave or refresh this page. You can keep it once it has started.
					</p>
					<p v-else-if="folder" class="text-muted -mt-2">
						A new chat in “{{ folder.name }}”, starting from its defaults.
					</p>

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
				</UContainer>
			</div>
		</template>
	</UDashboardPanel>
</template>
