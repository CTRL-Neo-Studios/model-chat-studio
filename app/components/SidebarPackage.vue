<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

/** Inside a package's studio: back to the list, its name, its pages, and what can be done on Explore as it stands. */
defineProps<{ collapsed?: boolean }>()

const route = useRoute()
const packageId = computed(() => route.params.id as string)
const base = computed(() => `/content/packages/${packageId.value}`)
const { found, listing } = usePackage(packageId)
const { listingActions, publishPackage } = useListingActions()

// A draft: "Publish". Published: its listing, an update or publishing again, unpublishing or putting back.
const explore = computed<NavigationMenuItem[]>(() => listing.value
	? [{ label: 'Open on Explore', icon: 'i-lucide-external-link', to: `/content/explore/${listing.value.id}` }, ...listingActions(listing.value) as NavigationMenuItem[]]
	: [{ label: 'Publish', icon: 'i-lucide-telescope', onSelect: () => publishPackage(packageId.value) }])

const items = computed<NavigationMenuItem[][]>(() => [
	[{ label: 'Packages', icon: 'i-lucide-arrow-left', to: '/content/packages' }],
	[
		{ label: found.value?.name ?? '', type: 'label' },
		...PACKAGE_SECTIONS.map(section => ({ label: section.label, icon: section.icon, to: `${base.value}${section.path}`, active: route.path === `${base.value}${section.path}` })),
	],
	[{ label: 'On Explore', type: 'label' }, ...explore.value],
])
</script>

<template>
	<UNavigationMenu :items="items" :collapsed="collapsed" orientation="vertical" />
</template>
