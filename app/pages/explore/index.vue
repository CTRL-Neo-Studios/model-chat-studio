<script setup lang="ts">
import { formatDistanceToNow } from 'date-fns'

useHead({ title: 'Explore' })

const route = useRoute()
const router = useRouter()
const text = (value: unknown) => typeof value === 'string' && value ? value : undefined

// The search lives in the address, so a reload or a shared link shows the same results.
const filters = computed(() => ({
	q: text(route.query.q),
	kind: text(route.query.kind),
	category: text(route.query.category),
	tag: text(route.query.tag),
	sort: text(route.query.sort) ?? 'newest',
	page: Number(route.query.page) || 1,
}))
const setFilters = (patch: Record<string, string | number | undefined>) => router.replace({ query: { ...route.query, page: undefined, ...patch } })

const searchTerm = ref(filters.value.q ?? '')
watchDebounced(searchTerm, term => setFilters({ q: term.trim() || undefined }), { debounce: 300 })

// The grid loads in the browser; a new search keeps the cards shown until its own arrive.
const { data, isPending } = useQuery(() => ({ ...exploreListingsQuery(filters.value), enabled: import.meta.client, placeholderData: previous => previous }))
const { data: settings } = useQuery(exploreSettingsQuery)
const listings = computed(() => data.value?.listings ?? [])

const ALL = 'all'
const kinds = [{ label: 'All', value: ALL }, ...Object.entries(LISTING_KINDS).map(([value, kind]) => ({ label: kind.plural, value, icon: kind.icon }))]
const kind = computed({ get: () => filters.value.kind ?? ALL, set: value => setFilters({ kind: value === ALL ? undefined : value }) })
const sorts = [{ label: 'Newest', value: 'newest' }, { label: 'Recently updated', value: 'updated' }, { label: 'Most got', value: 'gets' }]
const categories = computed(() => [{ label: 'All categories', value: ALL }, ...(settings.value?.categories ?? []).map(name => ({ label: name, value: name }))])
const page = computed({ get: () => filters.value.page, set: value => setFilters({ page: value > 1 ? value : undefined }) })
</script>

<template>
	<UDashboardPanel id="explore" class="min-h-0">
		<template #header>
			<UDashboardNavbar title="Explore">
				<template #right>
					<UButton icon="i-lucide-telescope" label="Your listings" color="neutral" variant="subtle" to="/explore/mine" />
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<div class="w-full max-w-5xl mx-auto flex flex-col gap-4">
				<p class="text-sm text-muted">
					Characters, libraries, structure profiles and whole setups members of this instance published. "Get" makes your own copies, yours to change.
				</p>
				<div class="flex flex-wrap items-center gap-2">
					<UInput v-model="searchTerm" icon="i-lucide-search" placeholder="Search names, summaries and tags" class="flex-1 min-w-56" aria-label="Search Explore" />
					<USelect v-if="settings?.categories.length" :model-value="filters.category ?? ALL" :items="categories" class="w-44" aria-label="Category" @update:model-value="value => setFilters({ category: value === ALL ? undefined : value })" />
					<USelect :model-value="filters.sort" :items="sorts" class="w-44" aria-label="Sort" @update:model-value="value => setFilters({ sort: value === 'newest' ? undefined : value })" />
				</div>
				<div class="flex flex-wrap items-center gap-2">
					<UTabs v-model="kind" :items="kinds" :content="false" size="sm" class="flex-1" />
					<UBadge v-if="filters.tag" :label="`#${filters.tag}`" color="primary" variant="subtle" size="lg" class="gap-1">
						<template #trailing>
							<UButton icon="i-lucide-x" size="xs" color="primary" variant="link" :aria-label="`Stop filtering by ${filters.tag}`" class="p-0" @click="setFilters({ tag: undefined })" />
						</template>
					</UBadge>
				</div>

				<div v-if="isPending && !data" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading Explore">
					<USkeleton v-for="n in 6" :key="n" class="h-36 w-full" />
				</div>
				<UEmpty
					v-else-if="!listings.length"
					icon="i-lucide-telescope"
					:title="filters.q || filters.kind || filters.category || filters.tag ? 'Nothing matches' : 'Nothing published yet'"
					:description="filters.q || filters.kind || filters.category || filters.tag ? 'Try other words or fewer filters.' : 'Publish a Character, a library, a structure profile or a folder\'s setup from its menu.'"
				/>
				<ul v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					<li v-for="listing in listings" :key="listing.id" class="relative flex flex-col gap-2 rounded-md border border-default p-4 hover:bg-elevated/50 has-focus-visible:ring-2 has-focus-visible:ring-primary">
						<div class="flex items-center gap-3 min-w-0">
							<UAvatar v-if="listing.avatarFileId" :src="`/api/v1/files/${listing.avatarFileId}`" :alt="listing.name" size="md" />
							<div v-else class="size-8 rounded-full bg-elevated flex items-center justify-center shrink-0">
								<UIcon :name="LISTING_KINDS[listing.kind].icon" class="size-4 text-muted" />
							</div>
							<!-- The link covers the card. -->
							<NuxtLink :to="`/explore/${listing.id}`" class="font-medium text-highlighted truncate flex-1 outline-none after:absolute after:inset-0">
								{{ listing.name }}
							</NuxtLink>
							<UBadge v-if="listing.featured" label="Featured" icon="i-lucide-star" color="warning" variant="subtle" size="sm" />
						</div>
						<p v-if="listing.summary" class="text-sm text-muted line-clamp-2">
							{{ listing.summary }}
						</p>
						<div v-if="listing.tags.length" class="relative flex flex-wrap gap-1">
							<UButton v-for="tag in listing.tags" :key="tag" :label="`#${tag}`" size="xs" color="neutral" variant="soft" @click="setFilters({ tag })" />
						</div>
						<div class="flex items-center gap-2 mt-auto text-xs text-dimmed min-w-0">
							<UBadge :label="LISTING_KINDS[listing.kind].label" color="neutral" variant="outline" size="sm" />
							<span class="truncate">{{ listing.publisher.name || listing.publisher.username }}</span>
							<span class="ms-auto flex items-center gap-1 shrink-0" :title="`Got by ${listing.gets}`">
								<UIcon name="i-lucide-download" class="size-3.5" />{{ listing.gets }}
							</span>
							<span class="shrink-0">{{ formatDistanceToNow(new Date(listing.publishedAt), { addSuffix: true }) }}</span>
						</div>
					</li>
				</ul>
				<UPagination v-if="data && data.total > data.pageSize" v-model:page="page" :total="data.total" :items-per-page="data.pageSize" class="self-center" />
			</div>
		</template>
	</UDashboardPanel>
</template>
