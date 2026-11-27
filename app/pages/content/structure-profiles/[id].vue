<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { PROFILE_TEMPLATES, type ProfileBlock } from '#shared/utils/structureProfile'

// One structure profile, edited on its page; `new` makes one from a template (`?template=` its label; `?instance=1`:
// an admin's instance profile). Keyed by the address, so opening another profile starts afresh.
definePageMeta({ key: route => route.path })

interface Draft { name: string, blocks: ProfileBlock[] }

const route = useRoute()
const creating = route.params.id === 'new'
const act = useApiAction()
const queryCache = useQueryCache()
const { user } = useUserSession()
const { data: profiles, isPending } = useQuery(structureProfilesQuery)
type Profile = NonNullable<typeof profiles.value>[number]
const profile = computed(() => profiles.value?.find(entry => entry.id === route.params.id))
useHead({ title: () => profile.value?.name ?? (creating ? 'New structure profile' : 'Structure profile') })

const instance = computed(() => creating ? route.query.instance === '1' : profile.value?.ownerId === null)
const canEdit = computed(() => !instance.value || user.value?.role === 'admin')

const newId = () => crypto.randomUUID()
function fromTemplate(): Draft {
	const template = PROFILE_TEMPLATES.find(entry => entry.label === route.query.template) ?? PROFILE_TEMPLATES[0]!
	return { name: template.name, blocks: template.blocks.map(block => ({ ...block, id: newId() }) as ProfileBlock) }
}

// The draft, and the profile as last saved, to tell what changed.
const draft = ref<Draft | undefined>(creating ? fromTemplate() : undefined)
// A new profile starts unsaved (nothing saved to match), so leaving it asks; saving clears that.
const saved = ref('')
watch(profile, (value) => {
	if (draft.value || !value) return
	draft.value = structuredClone({ name: value.name, blocks: value.blocks })
	saved.value = JSON.stringify(draft.value)
}, { immediate: true })

const dirty = computed(() => !!draft.value && JSON.stringify(draft.value) !== saved.value)
const valid = computed(() => !!draft.value?.name.trim() && draft.value.blocks.length <= 30)
useUnsavedGuard(() => dirty.value)

const saving = ref(false)
async function save() {
	if (!draft.value || !valid.value) return
	const body = { ...draft.value, name: draft.value.name.trim() }
	saving.value = true
	const result = creating
		? await act<Profile>('/api/v1/structure-profiles', { method: 'POST', body: { ...body, instance: instance.value || undefined }, success: 'Profile added' })
		: await act<Profile>(`/api/v1/structure-profiles/${route.params.id}`, { method: 'PATCH', body, success: 'Profile saved' })
	if (result) {
		queryCache.setQueryData(structureProfilesQuery.key, (list = []) => list.some(entry => entry.id === result.id) ? list.map(entry => entry.id === result.id ? result : entry) : [...list, result])
		draft.value = body
		saved.value = JSON.stringify(body)
		if (creating) await navigateTo(`/content/structure-profiles/${result.id}`, { replace: true })
	}
	saving.value = false
}

const roles = [
	{ label: 'System', value: 'system' },
	{ label: 'User', value: 'user' },
	{ label: 'Assistant', value: 'assistant' },
]
const has = (kind: ProfileBlock['kind']) => !!draft.value?.blocks.some(block => block.kind === kind)
const addItems = computed<DropdownMenuItem[]>(() => [
	{ label: 'Message', icon: 'i-lucide-message-square-text', onSelect: () => add({ id: newId(), kind: 'message', role: 'user', text: '' }) },
	{ label: 'Library files', icon: 'i-lucide-files', onSelect: () => add({ id: newId(), kind: 'files', paths: [] }) },
	{ label: 'Auto-fetched files', icon: 'i-lucide-folder-search', disabled: has('autoFetch'), onSelect: () => add({ id: newId(), kind: 'autoFetch' }) },
	{ label: 'Your Character', icon: 'i-lucide-drama', disabled: has('userCharacter'), onSelect: () => add({ id: newId(), kind: 'userCharacter' }) },
	{ label: 'Participants (group chats)', icon: 'i-lucide-users', disabled: has('participants'), onSelect: () => add({ id: newId(), kind: 'participants' }) },
])
const add = (block: ProfileBlock) => {
	draft.value!.blocks = [...draft.value!.blocks, block]
}
const remove = (index: number) => {
	draft.value!.blocks = draft.value!.blocks.toSpliced(index, 1)
}
function move(from: number, to: number) {
	const blocks = [...draft.value!.blocks]
	if (to < 0 || to >= blocks.length || from === to) return
	const [block] = blocks.splice(from, 1)
	blocks.splice(to, 0, block!)
	draft.value!.blocks = blocks
}

// Drag by the handle; the arrows do the same from the keyboard.
const dragging = ref<number | null>(null)
const over = ref<number | null>(null)
function onDrop(index: number) {
	if (dragging.value !== null) move(dragging.value, index)
	dragging.value = over.value = null
}

const label: Record<ProfileBlock['kind'], string> = { message: 'Message', history: 'Conversation', autoFetch: 'Auto-fetched files', files: 'Library files', userCharacter: 'Your Character', participants: 'Participants' }
const icon: Record<ProfileBlock['kind'], string> = { message: 'i-lucide-message-square-text', history: 'i-lucide-messages-square', autoFetch: 'i-lucide-folder-search', files: 'i-lucide-files', userCharacter: 'i-lucide-drama', participants: 'i-lucide-users' }
const estimate = (text: string) => Math.ceil(text.length / 4)
</script>

<template>
	<UDashboardPanel id="structure-profile" class="min-h-0">
		<template #header>
			<PageNavbar :current="profile?.name ?? (creating ? 'New structure profile' : '')">
				<template #right>
					<UBadge v-if="dirty" label="Not saved" color="warning" variant="subtle" />
					<UButton v-if="canEdit" label="Save" icon="i-lucide-check" :loading="saving" :disabled="!dirty || !valid" @click="save" />
				</template>
			</PageNavbar>
		</template>

		<template #body>
			<UError v-if="!creating && !isPending && !profile" :error="{ statusMessage: 'Structure profile not found', statusCode: 404 }" class="min-h-full" />
			<!-- A disabled fieldset turns every field into reading only. -->
			<fieldset v-else-if="draft" :disabled="!canEdit" class="w-full max-w-3xl mx-auto flex flex-col gap-4 min-w-0">
				<UAlert v-if="!canEdit" color="neutral" variant="subtle" icon="i-lucide-building" title="An instance profile" description="Admins keep it; you can pick it for a chat, or copy it to your profiles from the list." />
				<UFormField label="Name" required>
					<UInput v-model="draft.name" :maxlength="100" placeholder="e.g. Roleplay, Code review" class="w-full" />
				</UFormField>
				<p class="text-sm text-muted">
					Blocks are sent in this order, around the conversation. System messages at the very top become the instructions; later ones are sent as user messages. “Your Character” and “Participants” do the same: at the top they join the instructions, later they are sent as user messages.
				</p>

				<ol class="flex flex-col gap-2">
					<li
						v-for="(block, index) in draft.blocks"
						:key="block.id"
						:class="['rounded-md border border-default p-3 flex flex-col gap-2 bg-default', over === index && dragging !== index && 'ring-2 ring-primary', dragging === index && 'opacity-50']"
						@dragover.prevent="over = index"
						@dragleave="over = over === index ? null : over"
						@drop.prevent="onDrop(index)"
					>
						<div class="flex items-center gap-2">
							<span
								:draggable="canEdit"
								class="cursor-grab text-dimmed"
								:aria-label="`Drag ${label[block.kind]} block`"
								@dragstart="dragging = index"
								@dragend="dragging = over = null"
							><UIcon name="i-lucide-grip-vertical" class="size-4" /></span>
							<UIcon :name="icon[block.kind]" class="size-4 text-muted" />
							<span class="text-sm font-medium text-highlighted flex-1">{{ label[block.kind] }}</span>
							<USelect v-if="block.kind === 'message'" v-model="block.role" :items="roles" size="xs" class="w-32" aria-label="Role" />
							<UButton icon="i-lucide-arrow-up" color="neutral" variant="ghost" size="xs" aria-label="Move up" :disabled="index === 0" @click="move(index, index - 1)" />
							<UButton icon="i-lucide-arrow-down" color="neutral" variant="ghost" size="xs" aria-label="Move down" :disabled="index === draft.blocks.length - 1" @click="move(index, index + 1)" />
							<UButton v-if="block.kind !== 'history'" icon="i-lucide-trash" color="neutral" variant="ghost" size="xs" aria-label="Remove block" @click="remove(index)" />
						</div>
						<template v-if="block.kind === 'message'">
							<UTextarea v-model="block.text" :rows="3" autoresize :maxlength="50000" placeholder="What this message says" class="w-full" />
							<span class="text-xs text-dimmed self-end">~{{ estimate(block.text) }} tokens</span>
						</template>
						<p v-else-if="block.kind === 'history'" class="text-xs text-muted">
							The chat's messages, as the memory setting cuts them. Not editable.
						</p>
						<p v-else-if="block.kind === 'autoFetch'" class="text-xs text-muted">
							Where the files auto-fetch finds go. Without this block they go at the end.
						</p>
						<p v-else-if="block.kind === 'userCharacter'" class="text-xs text-muted">
							Who you are in the chat: your Character's name and instructions, when you have one. Without this block they go after the instructions.
						</p>
						<p v-else-if="block.kind === 'participants'" class="text-xs text-muted">
							Group chats only: who the model is, who else is here, and to answer only as itself. Without this block it goes at the end of the instructions.
						</p>
						<template v-else>
							<UInputTags v-model="block.paths" placeholder="A path, e.g. docs/conventions.md" add-on-blur add-on-paste :max="50" class="w-full" />
							<p class="text-xs text-muted">
								Sent with every answer, from the chat's library. A folder brings everything inside it; a path the library does not have is skipped.
							</p>
						</template>
					</li>
				</ol>

				<UDropdownMenu v-if="canEdit" :items="addItems">
					<UButton icon="i-lucide-plus" label="Add a block" color="neutral" variant="subtle" class="self-start" :disabled="draft.blocks.length >= 30" />
				</UDropdownMenu>
			</fieldset>
			<div v-else class="w-full max-w-3xl mx-auto flex flex-col gap-4" aria-busy="true" aria-label="Loading the structure profile">
				<USkeleton class="h-10 w-full" />
				<USkeleton class="h-48 w-full" />
			</div>
		</template>
	</UDashboardPanel>
</template>
