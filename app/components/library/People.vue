<script setup lang="ts">
interface Person {
	id: string
	username: string
	name: string | null
	avatarUrl: string | null
}

/** Who a library is shared with. The owner adds people, sets their roles and removes them; others see the list. */
const props = defineProps<{
	libraryId: string
	canManage: boolean
}>()

const act = useApiAction()
const queryCache = useQueryCache()
const membersKey = computed(() => libraryMembersQuery(props.libraryId).key)
const { data } = useQuery(() => libraryMembersQuery(props.libraryId))
const people = computed(() => data.value ?? [])

const ROLES = [
	{ label: 'Viewer: reads', value: 'viewer' },
	{ label: 'Editor: also edits files', value: 'editor' },
] as const
type Role = typeof ROLES[number]['value']
const ROLE_LABELS: Record<string, string> = { owner: 'Owner', viewer: 'Viewer', editor: 'Editor' }

async function setRole(person: Person, role: Role) {
	const before = people.value
	const known = before.some(entry => entry.id === person.id)
	queryCache.setQueryData(membersKey.value, known ? before.map(entry => entry.id === person.id ? { ...entry, role } : entry) : [...before, { ...person, role }])
	if (!await act(`/api/v1/libraries/${props.libraryId}/members/${person.id}`, { method: 'PUT', body: { role } })) queryCache.setQueryData(membersKey.value, before)
}

async function remove(person: Person) {
	const before = people.value
	queryCache.setQueryData(membersKey.value, before.filter(entry => entry.id !== person.id))
	if (!await act(`/api/v1/libraries/${props.libraryId}/members/${person.id}`, { method: 'DELETE' })) queryCache.setQueryData(membersKey.value, before)
}

// People search, as in a chat's share dialog: at least two characters, up to ten matches.
const searchTerm = ref('')
const results = ref<Person[]>([])
const searching = ref(false)
watchDebounced(searchTerm, async (term) => {
	if (term.trim().length < 2) {
		results.value = []
		return
	}
	searching.value = true
	results.value = await $fetch<Person[]>('/api/v1/users/search', { query: { q: term.trim() } }).catch(() => [])
	searching.value = false
}, { debounce: 250 })
const newRole = ref<Role>('viewer')
const items = computed(() => results.value
	.filter(person => !people.value.some(entry => entry.id === person.id))
	.map(person => ({ label: person.name || person.username, description: `@${person.username}`, avatar: { src: person.avatarUrl || undefined, alt: person.username }, person })))
function add(item: { person: Person } | undefined) {
	if (!item) return
	searchTerm.value = ''
	setRole(item.person, newRole.value)
}
</script>

<template>
	<UModal title="People" :description="canManage ? 'Share the library and choose what each person may do.' : 'Who this library is shared with.'" close>
		<UTooltip text="People">
			<UButton icon="i-lucide-users" color="neutral" variant="ghost" aria-label="People" />
		</UTooltip>

		<template #body>
			<div class="flex flex-col gap-4">
				<div v-if="canManage" class="flex gap-2">
					<!-- Remounted after each change, so the input empties instead of showing the person just added. -->
					<UInputMenu
						:key="people.length"
						v-model:search-term="searchTerm"
						:items="items"
						:loading="searching"
						ignore-filter
						:reset-search-term-on-blur="false"
						icon="i-lucide-user-plus"
						placeholder="Add people by name or username"
						class="flex-1"
						@update:model-value="add($event as { person: Person } | undefined)"
					>
						<template #empty>
							{{ searchTerm.trim().length < 2 ? 'Type at least two characters.' : 'Nobody found.' }}
						</template>
					</UInputMenu>
					<USelect v-model="newRole" :items="[...ROLES]" class="w-48" aria-label="Role for people added" />
				</div>

				<ul class="flex flex-col">
					<li v-for="person in people" :key="person.id" class="flex items-center gap-3 py-1.5">
						<UAvatar :src="person.avatarUrl || undefined" :alt="person.username" size="sm" />
						<div class="flex-1 min-w-0">
							<p class="text-sm text-highlighted truncate">
								{{ person.name || person.username }}
							</p>
							<p class="text-xs text-muted truncate">
								@{{ person.username }}
							</p>
						</div>
						<USelect
							v-if="canManage && person.role !== 'owner'"
							:model-value="person.role"
							:items="[...ROLES]"
							size="sm"
							class="w-48"
							:aria-label="`Role of ${person.username}`"
							@update:model-value="setRole(person, $event as Role)"
						/>
						<UBadge v-else :label="ROLE_LABELS[person.role]" color="neutral" variant="subtle" />
						<UButton
							v-if="canManage && person.role !== 'owner'"
							icon="i-lucide-x"
							size="xs"
							color="neutral"
							variant="ghost"
							:aria-label="`Remove ${person.username}`"
							@click="remove(person)"
						/>
					</li>
				</ul>
				<p v-if="canManage" class="text-xs text-muted">
					Viewers read the files and attach the library to their chats. Editors also change the files. Someone removed loses the library from their chats.
				</p>
			</div>
		</template>
	</UModal>
</template>
