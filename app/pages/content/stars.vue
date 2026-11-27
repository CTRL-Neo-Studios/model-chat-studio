<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { LazyModalConfirm, LazyModalRename } from '#components'

useHead({ title: 'Your stars' })

const act = useApiAction()
const overlay = useOverlay()
const queryCache = useQueryCache()
const { data, isPending } = useQuery(myStarsQuery)
const listings = computed(() => data.value?.listings ?? [])
const lists = computed(() => data.value?.lists ?? [])
type List = (typeof lists.value)[number]
const inList = (list: List) => list.listingIds.flatMap(id => listings.value.filter(listing => listing.id === id))
const { addToLists } = useStarLists()

const nameModal = overlay.create(LazyModalRename)
const confirm = overlay.create(LazyModalConfirm)
const refresh = () => queryCache.invalidateQueries({ key: myStarsQuery.key })

async function createList() {
	const name = await nameModal.open({ heading: 'New list', description: 'A list of starred listings, for you alone.', placeholder: 'e.g. Productivity', maxlength: 60 }).result
	if (name && await act('/api/v1/me/star-lists', { method: 'POST', body: { name }, success: 'List made' })) await refresh()
}
async function rename(list: List) {
	const name = await nameModal.open({ title: list.name, heading: 'Rename list', description: 'Only you see your lists.', placeholder: 'List name', maxlength: 60 }).result
	if (name && await act(`/api/v1/me/star-lists/${list.id}`, { method: 'PATCH', body: { name }, success: 'List renamed' })) await refresh()
}
async function describe(list: List) {
	const description = await nameModal.open({ title: list.description, heading: `Describe “${list.name}”`, description: 'A line about what goes in it.', placeholder: 'What it is for', maxlength: 300 }).result
	if (description && await act(`/api/v1/me/star-lists/${list.id}`, { method: 'PATCH', body: { description }, success: 'Saved' })) await refresh()
}
async function remove(list: List) {
	if (!await confirm.open({ title: `Delete “${list.name}”?`, description: 'The listings in it stay starred.', color: 'error' }).result) return
	if (await act(`/api/v1/me/star-lists/${list.id}`, { method: 'DELETE', success: 'List deleted' })) await refresh()
}
async function takeOut(list: List, listingId: string) {
	if (await act(`/api/v1/me/star-lists/${list.id}/listings/${listingId}`, { method: 'DELETE' })) await refresh()
}
const listActions = (list: List): DropdownMenuItem[][] => [[
	{ label: 'Rename…', icon: 'i-lucide-pencil', onSelect: () => rename(list) },
	{ label: 'Describe…', icon: 'i-lucide-text', onSelect: () => describe(list) },
], [{ label: 'Delete', icon: 'i-lucide-trash', color: 'error' as const, onSelect: () => remove(list) }]]
</script>

<template>
	<UDashboardPanel id="explore-stars" class="min-h-0">
		<template #header>
			<UDashboardNavbar title="Your stars">
				<template #right>
					<UButton icon="i-lucide-list-plus" label="New list" color="neutral" variant="subtle" @click="createList" />
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<div class="w-full max-w-5xl mx-auto flex flex-col gap-8">
				<div v-if="isPending" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading your stars">
					<USkeleton v-for="n in 3" :key="n" class="h-36 w-full" />
				</div>
				<template v-else>
					<section class="flex flex-col gap-3">
						<h2 class="font-semibold text-highlighted">
							All stars <span class="text-sm text-dimmed font-normal">{{ listings.length }}</span>
						</h2>
						<UEmpty v-if="!listings.length" icon="i-lucide-star" title="Nothing starred yet" description="Star what you like on Explore to find it here again, whether or not you got it." :actions="[{ label: 'Explore', icon: 'i-lucide-telescope', to: '/content/explore' }]" />
						<ul v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
							<ListingCard v-for="listing in listings" :key="listing.id" :listing="listing" @tag="tag => navigateTo({ path: '/content/explore', query: { tag } })">
								<template #actions>
									<UButton v-if="listing.available" icon="i-lucide-list-plus" size="xs" color="neutral" variant="ghost" :aria-label="`Add ${listing.name} to a list`" @click="addToLists(listing.id, listing.name)" />
								</template>
							</ListingCard>
						</ul>
					</section>

					<section v-for="list in lists" :key="list.id" class="flex flex-col gap-3">
						<div class="flex items-center gap-2">
							<h2 class="font-semibold text-highlighted">
								{{ list.name }} <span class="text-sm text-dimmed font-normal">{{ list.listingIds.length }}</span>
							</h2>
							<UDropdownMenu :items="listActions(list)" :content="{ align: 'start' }">
								<UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="xs" :aria-label="`Actions for ${list.name}`" />
							</UDropdownMenu>
						</div>
						<p v-if="list.description" class="text-sm text-muted -mt-2">
							{{ list.description }}
						</p>
						<p v-if="!list.listingIds.length" class="text-sm text-muted">
							Empty: "Add to a list…" on a listing puts it here.
						</p>
						<ul v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
							<ListingCard v-for="listing in inList(list)" :key="listing.id" :listing="listing" @tag="tag => navigateTo({ path: '/content/explore', query: { tag } })">
								<template #actions>
									<UButton icon="i-lucide-list-minus" label="Take out" size="xs" color="neutral" variant="ghost" @click="takeOut(list, listing.id)" />
								</template>
							</ListingCard>
						</ul>
					</section>
				</template>
			</div>
		</template>
	</UDashboardPanel>
</template>
