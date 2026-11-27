<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

useHead({ title: 'Published' })

const { data, isPending } = useQuery(myListingsQuery)
const listings = computed(() => data.value ?? [])
type Listing = (typeof listings.value)[number]
const { listingActions, update, remove } = useListingActions()

/** A waiting version's earlier rejection, kept beside it. */
const earlierReason = (listing: Listing) => listing.versions[1]?.status === 'rejected' ? listing.versions[1].reason : null

// A removed listing can only be deleted: a moderator took it off Explore.
const actions = (listing: Listing): DropdownMenuItem[][] => [
	...(listing.status === 'removed' ? [] : [listingActions(listing)]),
	[{ label: 'Delete', icon: 'i-lucide-trash', color: 'error' as const, onSelect: () => remove(listing) }],
]
</script>

<template>
	<UDashboardPanel id="explore-mine" class="min-h-0">
		<template #header>
			<PageNavbar />
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
								<NuxtLink :to="`/content/explore/${listing.id}`" class="block font-medium text-highlighted truncate hover:text-primary">
									{{ listing.name }}
								</NuxtLink>
								<p class="text-xs text-muted truncate">
									{{ LISTING_KINDS[listing.kind].label }} · {{ listing.version ? `version ${listing.version}` : 'not on Explore yet' }} · got by {{ listing.gets }} · {{ listing.stars }} {{ listing.stars === 1 ? 'star' : 'stars' }}<template v-if="listing.category">
										· {{ listing.category }}
									</template>
									<template v-if="listing.versions[0]?.status === 'approved' && listing.versions[0].reason">
										· not reviewed
									</template>
								</p>
							</div>
							<UBadge :label="listingState(listing).label" :color="listingState(listing).color" variant="subtle" />
							<UDropdownMenu :items="actions(listing)" :content="{ align: 'end' }">
								<UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="sm" :aria-label="`Actions for ${listing.name}`" />
							</UDropdownMenu>
						</div>
						<p v-if="listing.summary" class="text-sm text-muted line-clamp-2">
							{{ listing.summary }}
						</p>
						<UAlert v-if="listing.status === 'removed'" color="error" variant="subtle" icon="i-lucide-shield-alert" title="Removed by a moderator" :description="listing.statusReason ?? undefined" />
						<UAlert
							v-else-if="listing.versions[0]?.status === 'pending'"
							color="info"
							variant="subtle"
							icon="i-lucide-hourglass"
							:title="`Version ${listing.versions[0].number} is waiting for review`"
							:description="[listing.version ? `Version ${listing.version} stays on Explore meanwhile.` : 'It shows on Explore once an admin or moderator approves it.', earlierReason(listing) ? `Rejected before: ${earlierReason(listing)}` : ''].join(' ').trim()"
						/>
						<UAlert
							v-else-if="listing.versions[0]?.status === 'rejected'"
							color="error"
							variant="subtle"
							icon="i-lucide-circle-x"
							:title="`Rejected: ${listing.versions[0].reason}`"
							:description="listing.version ? `Version ${listing.version} stays on Explore. Change what is needed and publish again.` : 'It is not on Explore. Change what is needed and publish again.'"
							:actions="[{ label: 'Publish again…', icon: 'i-lucide-telescope', color: 'error', variant: 'subtle', onClick: () => update(listing, true) }]"
						/>
					</li>
				</ul>
			</div>
		</template>
	</UDashboardPanel>
</template>
