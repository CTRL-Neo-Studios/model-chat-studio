<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { formatDistanceToNow } from 'date-fns'

useHead({ title: 'Your listings' })

const { data, isPending } = useQuery(myListingsQuery)
const listings = computed(() => data.value ?? [])
type Listing = (typeof listings.value)[number]
const { edit, update, setListed, remove } = useListingActions()

const STATUS = {
	listed: { label: 'Listed', color: 'success' },
	unlisted: { label: 'Unlisted', color: 'neutral' },
	removed: { label: 'Removed', color: 'error' },
} as const

// A removed listing can only be deleted: a moderator took it off Explore.
const actions = (listing: Listing): DropdownMenuItem[][] => [
	...(listing.status === 'removed'
		? []
		: [[
				{ label: 'Edit…', icon: 'i-lucide-pencil', onSelect: () => edit(listing) },
				{ label: 'Publish an update…', icon: 'i-lucide-telescope', onSelect: () => update(listing) },
				listing.status === 'listed'
					? { label: 'Unlist', icon: 'i-lucide-eye-off', onSelect: () => setListed(listing, false) }
					: { label: 'List on Explore', icon: 'i-lucide-eye', onSelect: () => setListed(listing, true) },
			]]),
	[{ label: 'Delete', icon: 'i-lucide-trash', color: 'error' as const, onSelect: () => remove(listing) }],
]
</script>

<template>
	<UDashboardPanel id="explore-mine" class="min-h-0">
		<template #header>
			<UDashboardNavbar title="Your listings" />
		</template>

		<template #body>
			<div class="w-full max-w-3xl mx-auto flex flex-col gap-4">
				<p class="text-sm text-muted">
					What you published to Explore. Each listing is a copy of your items as they were; "Publish an update" adds a new version.
				</p>
				<div v-if="isPending" class="flex flex-col gap-2" aria-busy="true" aria-label="Loading your listings">
					<USkeleton v-for="n in 3" :key="n" class="h-16 w-full" />
				</div>
				<UEmpty
					v-else-if="!listings.length"
					icon="i-lucide-telescope"
					title="Nothing published yet"
					description="Publish a Character, a library or a structure profile from its menu, or a folder's setup as a pack."
				/>
				<ul v-else class="flex flex-col divide-y divide-default rounded-md border border-default">
					<li v-for="listing in listings" :key="listing.id" class="flex flex-col gap-2 px-4 py-3">
						<div class="flex items-center gap-3">
							<UIcon :name="LISTING_KINDS[listing.kind].icon" class="size-5 text-muted shrink-0" />
							<div class="flex-1 min-w-0">
								<p class="font-medium text-highlighted truncate">
									{{ listing.name }}
								</p>
								<p class="text-xs text-muted truncate">
									{{ LISTING_KINDS[listing.kind].label }} · version {{ listing.version }} · got by {{ listing.gets }} · published {{ formatDistanceToNow(new Date(listing.publishedAt), { addSuffix: true }) }}<template v-if="listing.category">
										· {{ listing.category }}
									</template>
								</p>
							</div>
							<UBadge :label="STATUS[listing.status].label" :color="STATUS[listing.status].color" variant="subtle" />
							<UDropdownMenu :items="actions(listing)" :content="{ align: 'end' }">
								<UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="sm" :aria-label="`Actions for ${listing.name}`" />
							</UDropdownMenu>
						</div>
						<p v-if="listing.summary" class="text-sm text-muted line-clamp-2">
							{{ listing.summary }}
						</p>
						<UAlert v-if="listing.status === 'removed'" color="error" variant="subtle" icon="i-lucide-shield-alert" title="Removed by a moderator" :description="listing.statusReason ?? undefined" />
					</li>
				</ul>
			</div>
		</template>
	</UDashboardPanel>
</template>
