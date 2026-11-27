<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { type CharacterFields, characterAvatarUrl } from '#shared/utils/character'
import { LazyModalConfirm, LazyModalImportReport } from '#components'

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

const confirm = overlay.create(LazyModalConfirm)
const { publishActions } = useListingActions()
const fields = ({ name, color, instructions, libraryIds, greetings, examples, note, creatorNotes, tags }: Character): CharacterFields => ({ name, color, instructions, libraryIds, greetings, examples, note, creatorNotes, tags })
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
	// The new Character opens on its page, with what the card could not carry.
	await navigateTo(`/content/characters/${result.character.id}`)
	if (result.report.length) reportModal.open({ name: result.character.name, report: result.report })
}

// A new Character is made on its own page; in the Instance tab, an admin's instance one.
const create = () => navigateTo({ path: '/content/characters/new', query: tab.value === 'instance' ? { instance: '1' } : {} })

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

// A card file: fetched, then saved under the name the server gives it.
const toast = useToast()
async function exportCard(character: Character, format: 'json' | 'png') {
	try {
		const response = await $fetch.raw<Blob>(`/api/v1/characters/${character.id}/card`, { query: { format }, responseType: 'blob' })
		const name = /filename\*=UTF-8''([^;]+)/.exec(response.headers.get('content-disposition') ?? '')?.[1]
		const link = document.createElement('a')
		link.href = URL.createObjectURL(response._data!)
		link.download = name ? decodeURIComponent(name) : `${character.name}.${format}`
		link.click()
		URL.revokeObjectURL(link.href)
	}
	catch (error) {
		toast.add({ title: 'The card could not be exported', description: serverMessage(error), icon: 'i-lucide-alert-circle', color: 'error' })
	}
}

function actions(character: Character): DropdownMenuItem[][] {
	const mine = character.ownerId !== null
	return [[
		...(canEdit.value ? [{ label: 'Edit', icon: 'i-lucide-pencil', to: `/content/characters/${character.id}` }] : []),
		...(mine
			? isAdmin.value ? [{ label: 'Publish for everyone', icon: 'i-lucide-share', onSelect: () => copy(character, true) }] : []
			: [{ label: 'Copy to my Characters', icon: 'i-lucide-copy', onSelect: () => copy(character, false) }]),
	], ...(mine ? [publishActions({ characterIds: [character.id] }, character.name)] : []), [
		// A card in its picture when the Character has an avatar; only a PNG one can carry it, the server says so otherwise.
		...(character.avatarFileId ? [{ label: 'Export card (PNG)', icon: 'i-lucide-image-down', onSelect: () => exportCard(character, 'png') }] : []),
		{ label: 'Export card (JSON)', icon: 'i-lucide-file-down', onSelect: () => exportCard(character, 'json') },
	], ...(canEdit.value ? [[{ label: 'Delete', icon: 'i-lucide-trash', color: 'error' as const, onSelect: () => remove(character) }]] : [])]
}

useNewFromLink(create)
</script>

<template>
	<UDashboardPanel id="characters" class="min-h-0">
		<template #header>
			<PageNavbar>
				<template #right>
					<input ref="picker" type="file" accept=".png,.json,image/png,application/json" class="hidden" @change="event => importCard((event.target as HTMLInputElement).files?.[0])">
					<UButton icon="i-lucide-file-up" label="Import card" color="neutral" variant="outline" :loading="importing" :ui="{ label: 'hidden sm:inline' }" aria-label="Import card" @click="picker?.click()" />
					<UButton v-if="canEdit" icon="i-lucide-plus" label="New Character" @click="create" />
				</template>
			</PageNavbar>
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
					<li v-for="character in shown" :key="character.id" class="relative flex flex-col gap-2 rounded-md border border-default p-4 hover:bg-elevated/50 has-focus-visible:ring-2 has-focus-visible:ring-primary">
						<div class="flex items-center gap-2">
							<LaneDot :color="character.color" :avatar="characterAvatarUrl(character)" avatar-class="size-8" dot-class="size-2.5" />
							<!-- The link covers the card; the buttons sit above it. -->
							<NuxtLink :to="`/content/characters/${character.id}`" class="font-medium text-highlighted truncate flex-1 outline-none after:absolute after:inset-0">
								{{ character.name }}
							</NuxtLink>
							<PublishedBadge v-if="character.ownerId !== null" :source="{ characterIds: [character.id] }" />
							<div class="relative flex items-center">
								<PinButton kind="character" :target-id="character.id" />
								<UDropdownMenu :items="actions(character)" :content="{ align: 'end' }">
									<UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="sm" aria-label="Character actions" />
								</UDropdownMenu>
							</div>
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
