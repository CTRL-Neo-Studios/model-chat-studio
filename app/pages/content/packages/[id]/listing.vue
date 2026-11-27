<script setup lang="ts">
import type { ListingTextsDraft } from '~/components/ListingTextsForm.vue'

// A package's Listing: the texts Explore shows. A draft's are the package's own (its name, and texts kept for when it
// is published); once published, the listing's, changed on Explore at once. With the card and the description as
// Explore shows them. Leaving with changes asks.
definePageMeta({ key: route => route.path })

const route = useRoute()
const packageId = route.params.id as string
const act = useApiAction()
const queryCache = useQueryCache()
const { found, error, listing } = usePackage(packageId)
const { user } = useUserSession()
useHead({ title: () => found.value ? `${found.value.name}: listing` : 'Package' })

// The texts as written, and as last saved, to tell what changed.
const draft = ref<ListingTextsDraft>()
const saved = ref('')
watch([found, listing], () => {
	if (draft.value || !found.value || (found.value.listingId && !listing.value)) return
	const { name, summary, description, tags, category } = listing.value ?? { name: found.value.name, ...found.value.texts }
	draft.value = { name, summary, description, tags, category }
	saved.value = JSON.stringify(draft.value)
}, { immediate: true })
const dirty = computed(() => !!draft.value && JSON.stringify(draft.value) !== saved.value)
const valid = computed(() => !!draft.value?.name.trim() && draft.value.tags.length <= 5)
useUnsavedGuard(() => dirty.value)

const saving = ref(false)
async function save() {
	if (!draft.value || !valid.value) return
	const { name, ...texts } = { ...draft.value, name: draft.value.name.trim() }
	saving.value = true
	const done = listing.value
		? await act(`/api/v1/explore/listings/${listing.value.id}`, { method: 'PATCH', body: { name, ...texts }, success: 'Listing saved' })
		: await act(`/api/v1/packages/${packageId}`, { method: 'PATCH', body: { name, texts }, success: 'Saved' })
	saving.value = false
	if (!done) return
	saved.value = JSON.stringify(draft.value)
	await Promise.all([queryCache.invalidateQueries({ key: ['packages'] }), queryCache.invalidateQueries({ key: myListingsQuery.key }), queryCache.invalidateQueries({ key: ['explore'] })])
}

// The card as Explore shows it, from the texts as written.
const card = computed(() => draft.value && {
	id: listing.value?.id ?? packageId,
	kind: 'pack' as const,
	name: draft.value.name || 'Untitled',
	summary: draft.value.summary,
	tags: draft.value.tags,
	featured: false,
	gets: listing.value?.gets ?? 0,
	stars: listing.value?.stars ?? 0,
	starred: false,
	available: true,
	publishedAt: listing.value?.publishedAt ?? new Date(),
	avatarFileId: null,
	publisher: { username: user.value?.username ?? '', name: user.value?.name ?? null },
})
</script>

<template>
	<UDashboardPanel id="package-listing" class="min-h-0">
		<template #header>
			<PageNavbar :current="found?.name">
				<template #right>
					<UBadge v-if="dirty" label="Not saved" color="warning" variant="subtle" />
					<UButton label="Save" icon="i-lucide-check" :loading="saving" :disabled="!dirty || !valid" @click="save" />
				</template>
			</PageNavbar>
		</template>

		<template #body>
			<UError v-if="error" :error="{ statusMessage: 'Package not found', statusCode: 404 }" class="min-h-full" />
			<div v-else-if="draft" class="w-full max-w-5xl mx-auto grid gap-6 lg:grid-cols-[1fr_20rem]">
				<div class="flex flex-col gap-4 min-w-0">
					<p class="text-sm text-muted">
						{{ listing ? 'The listing\'s texts on Explore: a change shows there at once, without a new version.' : 'The texts it is published with. The name is the package\'s too.' }}
					</p>
					<UAlert v-if="listing?.status === 'removed'" color="error" variant="subtle" icon="i-lucide-shield-alert" title="Removed by a moderator" description="Its texts can no longer be changed." />
					<fieldset :disabled="listing?.status === 'removed'" class="min-w-0">
						<ListingTextsForm v-model="draft" />
					</fieldset>
				</div>
				<!-- How Explore shows it; not a link here. -->
				<div class="flex flex-col gap-3">
					<p class="text-sm font-medium text-highlighted">
						On Explore
					</p>
					<ul v-if="card" inert>
						<ListingCard :listing="card" />
					</ul>
					<div v-if="draft.description" class="rounded-md border border-default p-3 text-sm max-h-96 overflow-y-auto">
						<ChatComark :value="draft.description" :streaming="false" />
					</div>
				</div>
			</div>
			<div v-else class="w-full max-w-3xl mx-auto flex flex-col gap-4" aria-busy="true" aria-label="Loading the package">
				<USkeleton v-for="n in 4" :key="n" class="h-12 w-full" />
			</div>
		</template>
	</UDashboardPanel>
</template>
