<script setup lang="ts">
useHead({ title: 'Content' })

const { user } = useUserSession()
const { data: characters } = useQuery(charactersQuery)
const { data: libraries } = useQuery(librariesQuery)
const { data: profiles } = useQuery(structureProfilesQuery)
const { data: packages } = useQuery(packagesQuery)
const { data: listings } = useQuery(myListingsQuery)
const { data: stars } = useQuery(myStarsQuery)
const { data: counts } = useQuery(exploreCountsQuery)
const { data: newest, isPending: explorePending } = useQuery(() => ({ ...exploreListingsQuery({ sort: 'newest', page: 1 }), enabled: import.meta.client }))

// What the member has of each kind; "New…" opens the kind's page with its "new" dialog.
const kinds = computed(() => {
	const shared = libraries.value?.filter(library => library.role !== 'owner').length ?? 0
	const onExplore = listings.value?.filter(listing => listing.status === 'listed' && listing.version).length ?? 0
	return [
		{ label: 'Characters', icon: 'i-lucide-drama', to: '/content/characters', count: characters.value?.filter(character => character.ownerId !== null).length, detail: 'Who a model is in a chat, or who you are', create: true },
		{ label: 'Libraries', icon: 'i-lucide-library-big', to: '/content/libraries', count: libraries.value?.length, detail: shared ? `${shared} shared with you` : 'Files and notes chats can read', create: true },
		{ label: 'Structure profiles', icon: 'i-lucide-layers', to: '/content/structure-profiles', count: profiles.value?.filter(profile => profile.ownerId !== null).length, detail: 'What a chat sends, in what order', create: true },
		{ label: 'Packages', icon: 'i-lucide-package', to: '/content/packages', count: packages.value?.length, detail: 'Several items and a setup, published as one', create: true },
		{ label: 'Published', icon: 'i-lucide-send', to: '/content/published', count: listings.value?.length, detail: `${onExplore} on Explore`, create: false },
		{ label: 'Your stars', icon: 'i-lucide-star', to: '/content/stars', count: stars.value?.listings.length, detail: `${stars.value?.lists.length ?? 0} star lists`, create: false },
	]
})

const staff = computed(() => getRoleLevel(user.value?.role) >= getRoleLevel('moderator'))
const search = ref('')
const openExplore = (query: Record<string, string>) => navigateTo({ path: '/content/explore', query })
</script>

<template>
	<UDashboardPanel id="content" class="min-h-0">
		<template #header>
			<PageNavbar />
		</template>

		<template #body>
			<div class="w-full max-w-5xl mx-auto flex flex-col gap-6">
				<p class="text-sm text-muted">
					What you made to chat with, what you published, and what others published on Explore.
				</p>

				<div v-if="counts?.attention || (staff && counts?.waiting)" class="flex flex-col gap-2">
					<UAlert
						v-if="counts?.attention"
						color="error"
						variant="subtle"
						icon="i-lucide-circle-alert"
						:title="`${counts.attention} of your listings ${counts.attention === 1 ? 'was' : 'were'} rejected or removed`"
						description="Read why, then publish again or delete."
						:actions="[{ label: 'Published', to: '/content/published', color: 'error', variant: 'subtle' }]"
					/>
					<UAlert
						v-if="staff && counts?.waiting"
						color="info"
						variant="subtle"
						icon="i-lucide-shield-check"
						:title="`${counts.waiting} ${counts.waiting === 1 ? 'thing waits' : 'things wait'} for review`"
						description="Publications and reports for admins and moderators."
						:actions="[{ label: 'Review', to: '/admin/review', color: 'info', variant: 'subtle' }]"
					/>
				</div>

				<section class="flex flex-col gap-3" aria-labelledby="content-mine">
					<h2 id="content-mine" class="font-semibold text-highlighted">
						My content
					</h2>
					<ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						<li v-for="kind in kinds" :key="kind.to" class="relative flex items-start gap-3 rounded-md border border-default p-4 hover:bg-elevated/50 has-focus-visible:ring-2 has-focus-visible:ring-primary">
							<UIcon :name="kind.icon" class="size-5 text-muted shrink-0 mt-0.5" />
							<div class="flex-1 min-w-0">
								<!-- The link covers the card; "New…" sits above it. -->
								<NuxtLink :to="kind.to" class="font-medium text-highlighted outline-none after:absolute after:inset-0">
									{{ kind.label }}
								</NuxtLink>
								<span class="ms-2 text-sm text-dimmed">{{ kind.count ?? '' }}</span>
								<p class="text-xs text-muted truncate">
									{{ kind.detail }}
								</p>
							</div>
							<UButton v-if="kind.create" :to="{ path: kind.to, query: { new: 1 } }" icon="i-lucide-plus" size="xs" color="neutral" variant="ghost" class="relative" :aria-label="`New in ${kind.label}`" />
						</li>
					</ul>
				</section>

				<section class="flex flex-col gap-3" aria-labelledby="content-explore">
					<div class="flex flex-wrap items-center gap-2">
						<h2 id="content-explore" class="font-semibold text-highlighted flex-1">
							New on Explore
						</h2>
						<form class="flex-1 min-w-56" role="search" @submit.prevent="search.trim() && openExplore({ q: search.trim() })">
							<UInput v-model="search" icon="i-lucide-search" placeholder="Search Explore" class="w-full" aria-label="Search Explore" />
						</form>
						<UButton label="All of Explore" trailing-icon="i-lucide-arrow-right" color="neutral" variant="ghost" to="/content/explore" />
					</div>
					<div v-if="explorePending" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading Explore">
						<USkeleton v-for="n in 3" :key="n" class="h-36 w-full" />
					</div>
					<UEmpty v-else-if="!newest?.listings.length" icon="i-lucide-telescope" title="Nothing published yet" description="Publish a Character, a library, a structure profile or a folder's setup from its menu." />
					<ul v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						<ListingCard v-for="listing in newest.listings.slice(0, 6)" :key="listing.id" :listing="listing" @tag="tag => openExplore({ tag })" />
					</ul>
				</section>
			</div>
		</template>
	</UDashboardPanel>
</template>
