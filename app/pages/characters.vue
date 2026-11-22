<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { CharacterFields } from '#shared/utils/character'
import { LazyCharacterEditor, LazyModalConfirm } from '#components'

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
const fields = ({ name, color, instructions, libraryIds }: Character): CharacterFields => ({ name, color, instructions, libraryIds })

async function create() {
	const draft = await editor.open({ title: 'New Character', character: { name: '', color: null, instructions: '', libraryIds: [] } }).result
	if (!draft) return
	const created = await act<Character>('/api/v1/characters', { method: 'POST', body: { ...draft, instance: tab.value === 'instance' || undefined }, success: 'Character added' })
	if (created) queryCache.setQueryData(charactersQuery.key, [...characters.value, created])
}

async function edit(character: Character) {
	const draft = await editor.open({ title: 'Edit Character', character: fields(character) }).result
	if (!draft) return
	const saved = await act<Character>(`/api/v1/characters/${character.id}`, { method: 'PATCH', body: draft, success: 'Character saved' })
	if (saved) queryCache.setQueryData(charactersQuery.key, characters.value.map(entry => entry.id === character.id ? saved : entry))
}

async function copy(character: Character, instance: boolean) {
	// A copy leaves out libraries: the new owner may not read them.
	const created = await act<Character>('/api/v1/characters', { method: 'POST', body: { ...fields(character), libraryIds: [], instance: instance || undefined }, success: instance ? 'Published for everyone' : 'Copied to your Characters' })
	if (created) queryCache.setQueryData(charactersQuery.key, [...characters.value, created])
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
					<UButton v-if="canEdit" icon="i-lucide-plus" label="New Character" @click="create" />
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<div class="w-full max-w-5xl mx-auto flex flex-col gap-4">
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
							<span :class="['size-2.5 rounded-full shrink-0', character.color ? LANE_COLOR_CLASSES[character.color] : 'bg-(--ui-border-accented)']" />
							<span class="font-medium text-highlighted truncate flex-1">{{ character.name }}</span>
							<PinButton kind="character" :target-id="character.id" />
							<UDropdownMenu :items="actions(character)" :content="{ align: 'end' }">
								<UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="sm" aria-label="Character actions" />
							</UDropdownMenu>
						</div>
						<p class="text-sm text-muted line-clamp-3" :class="!character.instructions && 'italic'">
							{{ character.instructions || 'No instructions: the default ones apply.' }}
						</p>
						<div v-if="character.libraryIds.length" class="mt-auto">
							<UBadge :label="`${character.libraryIds.length} ${character.libraryIds.length === 1 ? 'library' : 'libraries'}`" icon="i-lucide-library-big" color="neutral" variant="subtle" size="sm" />
						</div>
					</li>
				</ul>
			</div>
		</template>
	</UDashboardPanel>
</template>
