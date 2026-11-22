<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { formatDistanceToNow } from 'date-fns'
import { LazyModalConfirm, LazyModalDeleteLibrary, LazyModalRename } from '#components'

useHead({ title: 'Libraries' })

const act = useApiAction()
const overlay = useOverlay()
const queryCache = useQueryCache()
const { data, isPending } = useQuery(librariesQuery)
const { pinnedFirst } = usePins()
// A library and its files load while the pointer is over its card or the card has focus, so opening it is instant.
const prefetch = usePrefetch()
const prefetchLibrary = (id: string) => prefetch(libraryQuery(id), libraryEntriesQuery(id))
const libraries = computed(() => data.value ?? [])
const shown = computed(() => pinnedFirst('library', libraries.value))
type Library = (typeof libraries.value)[number]

const nameModal = overlay.create(LazyModalRename)
const confirm = overlay.create(LazyModalConfirm)
const deleteModal = overlay.create(LazyModalDeleteLibrary)
const { user } = useUserSession()

const nameProps = { heading: 'New library', description: 'A library holds files, notes and folders that chats can read.', placeholder: 'Library name', maxlength: 100 }

async function create() {
	const name = await nameModal.open(nameProps).result
	if (!name) return
	const library = await act<Library>('/api/v1/libraries', { method: 'POST', body: { name } })
	if (!library) return
	queryCache.setQueryData(librariesQuery.key, list => [{ ...library, role: 'owner' as const }, ...(list ?? [])])
	await navigateTo(`/libraries/${library.id}`)
}

// Renames and deletions show at once; the list comes back as it was if the server refuses.
async function rename(library: Library) {
	const name = await nameModal.open({ ...nameProps, title: library.name, heading: 'Rename library', description: 'Choose a new name for this library.' }).result
	if (!name || name === library.name) return
	const before = libraries.value
	queryCache.setQueryData(librariesQuery.key, before.map(entry => entry.id === library.id ? { ...entry, name } : entry))
	if (!await act(`/api/v1/libraries/${library.id}`, { method: 'PATCH', body: { name } })) queryCache.setQueryData(librariesQuery.key, before)
}

async function remove(library: Library) {
	if (!await deleteModal.open({ libraryId: library.id, name: library.name }).result) return
	const before = libraries.value
	queryCache.setQueryData(librariesQuery.key, before.filter(entry => entry.id !== library.id))
	if (!await act(`/api/v1/libraries/${library.id}`, { method: 'DELETE', success: 'Library deleted' })) queryCache.setQueryData(librariesQuery.key, before)
}

async function leave(library: Library) {
	const confirmed = await confirm.open({ title: 'Leave library', description: `You leave “${library.name}”. It comes off your chats.`, color: 'error' }).result
	if (!confirmed || !user.value) return
	const before = libraries.value
	queryCache.setQueryData(librariesQuery.key, before.filter(entry => entry.id !== library.id))
	if (!await act(`/api/v1/libraries/${library.id}/members/${user.value.id}`, { method: 'DELETE', success: 'You left the library' })) queryCache.setQueryData(librariesQuery.key, before)
}

const ROLE_LABELS = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' } as const
const actions = (library: Library): DropdownMenuItem[][] => library.role === 'owner'
	? [
			[{ label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => rename(library) }],
			[{ label: 'Delete', icon: 'i-lucide-trash', color: 'error', onSelect: () => remove(library) }],
		]
	: [[{ label: 'Leave library', icon: 'i-lucide-log-out', color: 'error', onSelect: () => leave(library) }]]
</script>

<template>
	<UDashboardPanel id="libraries" class="min-h-0">
		<template #header>
			<UDashboardNavbar title="Libraries">
				<template #right>
					<UButton icon="i-lucide-plus" label="New library" @click="create" />
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<div class="w-full max-w-5xl mx-auto flex flex-col gap-4">
				<div v-if="isPending" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading libraries">
					<USkeleton v-for="n in 3" :key="n" class="h-24 w-full" />
				</div>
				<UEmpty
					v-else-if="!libraries.length"
					icon="i-lucide-library-big"
					title="No libraries yet"
					description="A library keeps files, notes and folders together, for chats to read."
					:actions="[{ label: 'New library', icon: 'i-lucide-plus', onClick: create }]"
				/>
				<ul v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					<li
						v-for="library in shown"
						:key="library.id"
						class="relative flex flex-col gap-2 rounded-md border border-default p-4 hover:bg-elevated/50 has-focus-visible:ring-2 has-focus-visible:ring-primary"
						@pointerenter="prefetchLibrary(library.id)"
						@focusin="prefetchLibrary(library.id)"
					>
						<div class="flex items-center gap-2">
							<UIcon name="i-lucide-library-big" class="size-5 text-muted shrink-0" />
							<!-- The link covers the card; the buttons sit above it. -->
							<NuxtLink :to="`/libraries/${library.id}`" class="font-medium text-highlighted truncate flex-1 outline-none after:absolute after:inset-0">
								{{ library.name }}
							</NuxtLink>
							<div class="relative flex items-center">
								<PinButton kind="library" :target-id="library.id" />
								<UDropdownMenu :items="actions(library)" :content="{ align: 'end' }">
									<UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="sm" aria-label="Library actions" />
								</UDropdownMenu>
							</div>
						</div>
						<p v-if="library.description" class="text-sm text-muted line-clamp-2">
							{{ library.description }}
						</p>
						<div class="flex items-center gap-2 mt-auto">
							<span class="text-xs text-dimmed">Created {{ formatDistanceToNow(new Date(library.createdAt), { addSuffix: true }) }}</span>
							<UBadge v-if="library.role !== 'owner'" :label="`Shared · ${ROLE_LABELS[library.role]}`" color="neutral" variant="subtle" size="sm" class="ms-auto" />
						</div>
					</li>
				</ul>
			</div>
		</template>
	</UDashboardPanel>
</template>
