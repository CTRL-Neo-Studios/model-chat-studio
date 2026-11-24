<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { type CharacterFields, characterAvatarUrl } from '#shared/utils/character'
import { LazyCharacterEditor, LazyModalConfirm, LazyModalImportReport } from '#components'

useHead({ title: 'Characters' })

const act = useApiAction()
const overlay = useOverlay()
const { user } = useUserSession()
const queryCache = useQueryCache()
const { pinnedFirst } = usePins()
const { data, isPending } = useQuery(charactersQuery)
const characters = computed(() => data.value ?? [])
type Character = (typeof characters.value)[number]

const isAdmin = computed(() => user.value?.role === 'admin')
const tab = ref<'mine' | 'instance'>('mine')
const tabs = [
	{ label: 'Mine', value: 'mine', icon: 'i-lucide-user' },
	{ label: 'Instance', value: 'instance', icon: 'i-lucide-building' },
]
const shown = computed(() => pinnedFirst('character', characters.value.filter(character => (character.ownerId === null) === (tab.value === 'instance'))))
const canEdit = computed(() => tab.value === 'mine' || isAdmin.value)

const editor = overlay.create(LazyCharacterEditor)
const confirm = overlay.create(LazyModalConfirm)
const fields = ({ name, color, instructions, libraryIds, greetings, examples, note, creatorNotes, tags }: Character): CharacterFields => ({ name, color, instructions, libraryIds, greetings, examples, note, creatorNotes, tags })
const blank: CharacterFields = { name: '', color: null, instructions: '', libraryIds: [], greetings: [], examples: '', note: '', creatorNotes: '', tags: [] }
const store = (saved: Character) => queryCache.setQueryData(charactersQuery.key, characters.value.some(entry => entry.id === saved.id) ? characters.value.map(entry => entry.id === saved.id ? saved : entry) : [...characters.value, saved])

// "Import card": a PNG with a card in it, or a card's JSON, becomes a Character of yours (under "Mine").
const reportModal = overlay.create(LazyModalImportReport)
const picker = ref<HTMLInputElement>()
const importing = ref(false)
async function importCard(file: File | undefined) {
	if (!file || importing.value) return
	if (picker.value) picker.value.value = ''
	const form = new FormData()
	form.append('file', file)
	importing.value = true
	const result = await act<{ character: Character, report: string[] }>('/api/v1/characters/import', { method: 'POST', body: form, success: 'Card imported' })
	importing.value = false
	if (!result) return
	store(result.character)
	tab.value = 'mine'
	if (result.report.length) reportModal.open({ name: result.character.name, report: result.report })
}

/** Sends an avatar chosen in the editor once the Character exists: a new image, or `null` to remove it. */
async function sendAvatar(character: Character, avatar: File | null | undefined) {
	if (avatar === undefined) return
	const form = new FormData()
	if (avatar) form.append('file', avatar)
	const saved = await act<Character>(`/api/v1/characters/${character.id}/avatar`, avatar ? { method: 'PUT', body: form } : { method: 'DELETE' })
	if (saved) store(saved)
}

async function create() {
	const result = await editor.open({ title: 'New Character', character: blank }).result
	if (!result) return
	const created = await act<Character>('/api/v1/characters', { method: 'POST', body: { ...result.fields, instance: tab.value === 'instance' || undefined }, success: 'Character added' })
	if (!created) return
	store(created)
	await sendAvatar(created, result.avatar)
}

async function edit(character: Character) {
	const result = await editor.open({ title: 'Edit Character', character: fields(character), avatar: characterAvatarUrl(character) }).result
	if (!result) return
	const saved = await act<Character>(`/api/v1/characters/${character.id}`, { method: 'PATCH', body: result.fields, success: 'Character saved' })
	if (!saved) return
	store(saved)
	await sendAvatar(saved, result.avatar)
}

async function copy(character: Character, instance: boolean) {
	// A copy leaves out libraries (the new owner may not read them) and the avatar.
	const created = await act<Character>('/api/v1/characters', { method: 'POST', body: { ...fields(character), libraryIds: [], instance: instance || undefined }, success: instance ? 'Published for everyone' : 'Copied to your Characters' })
	if (created) store(created)
}

async function remove(character: Character) {
	const confirmed = await confirm.open({ title: 'Delete Character', description: `“${character.name}” will be deleted. Models and chats using it go back to their own prompt.`, color: 'error' }).result
	if (!confirmed) return
	const before = characters.value
	queryCache.setQueryData(charactersQuery.key, before.filter(entry => entry.id !== character.id))
	if (!await act(`/api/v1/characters/${character.id}`, { method: 'DELETE', success: 'Character deleted' })) queryCache.setQueryData(charactersQuery.key, before)
}

function actions(character: Character): DropdownMenuItem[][] {
	const mine = character.ownerId !== null
	return [[
		...(canEdit.value ? [{ label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => edit(character) }] : []),
		...(mine
			? (isAdmin.value ? [{ label: 'Publish for everyone', icon: 'i-lucide-share', onSelect: () => copy(character, true) }] : [])
			: [{ label: 'Copy to my Characters', icon: 'i-lucide-copy', onSelect: () => copy(character, false) }]),
	], ...(canEdit.value ? [[{ label: 'Delete', icon: 'i-lucide-trash', color: 'error' as const, onSelect: () => remove(character) }]] : [])]
}
</script>

<template>
	<UDashboardPanel id="characters" class="min-h-0">
		<template #header>
			<UDashboardNavbar title="Characters">
				<template #right>
					<input ref="picker" type="file" accept=".png,.json,image/png,application/json" class="hidden" @change="event => importCard((event.target as HTMLInputElement).files?.[0])">
					<UButton icon="i-lucide-file-up" label="Import card" color="neutral" variant="outline" :loading="importing" :ui="{ label: 'hidden sm:inline' }" aria-label="Import card" @click="picker?.click()" />
					<UButton v-if="canEdit" icon="i-lucide-plus" label="New Character" @click="create" />
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<!-- A card file dropped anywhere here is imported, as "Import card" does. -->
			<div class="w-full max-w-5xl mx-auto flex flex-col gap-4" @dragover.prevent @drop.prevent="event => importCard(event.dataTransfer?.files[0])">
				<p class="text-sm text-muted">
					A Character is who a model is in a chat, or who you are. Give it to a model in a chat or a model profile; its instructions take the place of the system prompt.
				</p>
				<UTabs v-model="tab" :items="tabs" :content="false" class="w-full" />

				<div v-if="isPending" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading Characters">
					<USkeleton v-for="n in 3" :key="n" class="h-24 w-full" />
				</div>
				<UEmpty
					v-else-if="!shown.length"
					icon="i-lucide-drama"
					:title="tab === 'mine' ? 'No Characters yet' : 'No instance Characters'"
					:description="tab === 'mine' ? 'An Engineer, a Designer, a narrator: whoever a model should be.' : isAdmin ? 'Publish a Character for every member.' : 'An admin can publish Characters for everyone.'"
					:actions="canEdit ? [{ label: 'New Character', icon: 'i-lucide-plus', onClick: create }] : undefined"
				/>
				<ul v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					<li v-for="character in shown" :key="character.id" class="flex flex-col gap-2 rounded-md border border-default p-4">
						<div class="flex items-center gap-2">
							<LaneDot :color="character.color" :avatar="characterAvatarUrl(character)" avatar-class="size-8" dot-class="size-2.5" />
							<span class="font-medium text-highlighted truncate flex-1">{{ character.name }}</span>
							<PinButton kind="character" :target-id="character.id" />
							<UDropdownMenu :items="actions(character)" :content="{ align: 'end' }">
								<UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="sm" aria-label="Character actions" />
							</UDropdownMenu>
						</div>
						<p class="text-sm text-muted line-clamp-3" :class="!character.instructions && 'italic'">
							{{ character.instructions || 'No instructions: the default ones apply.' }}
						</p>
						<div v-if="character.libraryIds.length || character.greetings.length || character.tags.length" class="mt-auto flex flex-wrap gap-1.5">
							<UBadge v-if="character.greetings.length" :label="`${character.greetings.length} ${character.greetings.length === 1 ? 'greeting' : 'greetings'}`" icon="i-lucide-message-circle" color="neutral" variant="subtle" size="sm" />
							<UBadge v-if="character.libraryIds.length" :label="`${character.libraryIds.length} ${character.libraryIds.length === 1 ? 'library' : 'libraries'}`" icon="i-lucide-library-big" color="neutral" variant="subtle" size="sm" />
							<UBadge v-for="tag in character.tags.slice(0, 4)" :key="tag" :label="tag" color="neutral" variant="outline" size="sm" />
						</div>
					</li>
				</ul>
			</div>
		</template>
	</UDashboardPanel>
</template>
