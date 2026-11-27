<script setup lang="ts">
// A package's Overview: its state, what publishing it would hold now, its size against the instance's limit, and
// what was left out. Keyed by the address, so opening another package starts afresh.
definePageMeta({ key: route => route.path })

const route = useRoute()
const packageId = route.params.id as string
const { data: found, error } = useQuery(() => packageQuery(packageId))
const { data: settings } = useQuery(exploreSettingsQuery)
useHead({ title: () => found.value?.name ?? 'Package' })

const empty = computed(() => !!found.value && !found.value.setup && !Object.values(found.value.items).some(ids => ids.length))
</script>

<template>
	<UDashboardPanel id="package-overview" class="min-h-0">
		<template #header>
			<PageNavbar :current="found?.name" />
		</template>

		<template #body>
			<UError v-if="error" :error="{ statusMessage: 'Package not found', statusCode: 404 }" class="min-h-full" />
			<div v-else-if="found" class="w-full max-w-3xl mx-auto flex flex-col gap-5">
				<div class="flex items-center gap-3">
					<UIcon name="i-lucide-package" class="size-6 text-muted" />
					<h1 class="text-xl font-semibold text-highlighted flex-1 truncate">
						{{ found.name }}
					</h1>
					<UBadge label="Draft" color="neutral" variant="subtle" />
				</div>
				<p class="text-sm text-muted">
					A draft: only you see it. It points at your items, so changing one changes what the package holds; publishing copies them as they are then.
				</p>
				<UEmpty
					v-if="empty"
					icon="i-lucide-boxes"
					title="Nothing in it yet"
					description="Add Characters, libraries or structure profiles of yours."
					:actions="[{ label: 'Add items', icon: 'i-lucide-plus', to: `/content/packages/${packageId}/items` }]"
				/>
				<ListingPreview v-else :source="{ packageId }" :limit-bytes="settings ? settings.maxSizeMb * 1024 * 1024 : undefined" />
			</div>
			<div v-else class="w-full max-w-3xl mx-auto flex flex-col gap-4" aria-busy="true" aria-label="Loading the package">
				<USkeleton class="h-8 w-64" />
				<USkeleton class="h-32 w-full" />
			</div>
		</template>
	</UDashboardPanel>
</template>
