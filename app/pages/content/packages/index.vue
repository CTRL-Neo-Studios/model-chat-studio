<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { LazyModalConfirm, LazyModalRename } from '#components'

useHead({ title: 'Packages' })

const act = useApiAction()
const overlay = useOverlay()
const queryCache = useQueryCache()
const { data, isPending } = useQuery(packagesQuery)
const packages = computed(() => data.value ?? [])
type ContentPackage = (typeof packages.value)[number]
const { data: listings } = useQuery(myListingsQuery)

const nameModal = overlay.create(LazyModalRename)
const confirm = overlay.create(LazyModalConfirm)
const nameProps = { placeholder: 'e.g. Full-stack dev team', maxlength: 80 }

/** What a package holds, in words. */
function holds(entry: ContentPackage) {
	const count = (n: number, one: string, many: string) => n ? `${n} ${n === 1 ? one : many}` : ''
	const parts = [
		count(entry.items.characterIds.length, 'Character', 'Characters'),
		count(entry.items.libraryIds.length, 'library', 'libraries'),
		count(entry.items.structureProfileIds.length, 'structure profile', 'structure profiles'),
		entry.setup ? 'a setup' : '',
	].filter(Boolean)
	return parts.length ? parts.join(', ') : 'Nothing yet'
}
/** A draft until published; then its listing's state. */
function state(entry: ContentPackage) {
	const listing = entry.listingId && listings.value?.find(row => row.id === entry.listingId)
	return listing ? listingState(listing) : { label: 'Draft', color: 'neutral' as const }
}

async function create() {
	const name = await nameModal.open({ ...nameProps, heading: 'New package', description: 'Characters, libraries and structure profiles of yours, and a chat setup, published as one.' }).result
	if (!name) return
	const created = await act<ContentPackage>('/api/v1/packages', { method: 'POST', body: { name } })
	if (!created) return
	await queryCache.invalidateQueries({ key: packagesQuery.key })
	await navigateTo(`/content/packages/${created.id}/items`)
}

async function rename(entry: ContentPackage) {
	const name = await nameModal.open({ ...nameProps, title: entry.name, heading: 'Rename package', description: 'Its listing keeps its own name.' }).result
	if (!name || name === entry.name) return
	if (await act(`/api/v1/packages/${entry.id}`, { method: 'PATCH', body: { name } })) await queryCache.invalidateQueries({ key: packagesQuery.key })
}

async function remove(entry: ContentPackage) {
	const description = entry.listingId ? `“${entry.name}” and its listing on Explore are deleted. Copies people got stay theirs; your items stay too.` : `“${entry.name}” is deleted. Your items stay.`
	if (!await confirm.open({ title: 'Delete package', description, color: 'error' }).result) return
	if (await act(`/api/v1/packages/${entry.id}`, { method: 'DELETE', success: 'Package deleted' })) {
		await Promise.all([queryCache.invalidateQueries({ key: packagesQuery.key }), queryCache.invalidateQueries({ key: myListingsQuery.key })])
	}
}

const actions = (entry: ContentPackage): DropdownMenuItem[][] => [
	[{ label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => rename(entry) }],
	[{ label: 'Delete', icon: 'i-lucide-trash', color: 'error', onSelect: () => remove(entry) }],
]

useNewFromLink(create)
</script>

<template>
	<UDashboardPanel id="packages" class="min-h-0">
		<template #header>
			<PageNavbar>
				<template #right>
					<UButton icon="i-lucide-plus" label="New package" @click="create" />
				</template>
			</PageNavbar>
		</template>

		<template #body>
			<div class="w-full max-w-5xl mx-auto flex flex-col gap-4">
				<p class="text-sm text-muted">
					A package is several of your items and, if you like, a chat setup, published to Explore as one. It points at your items: publishing copies them as they are then.
				</p>
				<div v-if="isPending" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading packages">
					<USkeleton v-for="n in 3" :key="n" class="h-24 w-full" />
				</div>
				<UEmpty
					v-else-if="!packages.length"
					icon="i-lucide-package"
					title="No packages yet"
					description="A team of Characters with their libraries and the group chat they start, for example."
					:actions="[{ label: 'New package', icon: 'i-lucide-plus', onClick: create }]"
				/>
				<ul v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					<li v-for="entry in packages" :key="entry.id" class="relative flex flex-col gap-2 rounded-md border border-default p-4 hover:bg-elevated/50 has-focus-visible:ring-2 has-focus-visible:ring-primary">
						<div class="flex items-center gap-2">
							<UIcon name="i-lucide-package" class="size-5 text-muted shrink-0" />
							<!-- The link covers the card; the menu sits above it. -->
							<NuxtLink :to="`/content/packages/${entry.id}`" class="font-medium text-highlighted truncate flex-1 outline-none after:absolute after:inset-0">
								{{ entry.name }}
							</NuxtLink>
							<UBadge :label="state(entry).label" :color="state(entry).color" variant="subtle" size="sm" />
							<UDropdownMenu :items="actions(entry)" :content="{ align: 'end' }">
								<UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="sm" class="relative" :aria-label="`Actions for ${entry.name}`" />
							</UDropdownMenu>
						</div>
						<p class="text-sm text-muted">
							{{ holds(entry) }}
						</p>
					</li>
				</ul>
			</div>
		</template>
	</UDashboardPanel>
</template>
