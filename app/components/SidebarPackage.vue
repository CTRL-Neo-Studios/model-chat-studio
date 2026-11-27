<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

/** Inside a package's studio: back to the list, its name, and its pages. */
defineProps<{ collapsed?: boolean }>()

const route = useRoute()
const base = computed(() => `/content/packages/${route.params.id}`)
const { data: found } = useQuery(() => packageQuery(route.params.id as string))

const items = computed<NavigationMenuItem[][]>(() => [
	[{ label: 'Packages', icon: 'i-lucide-arrow-left', to: '/content/packages' }],
	[
		{ label: found.value?.name ?? '', type: 'label' },
		...PACKAGE_SECTIONS.map(section => ({ label: section.label, icon: section.icon, to: `${base.value}${section.path}`, active: route.path === `${base.value}${section.path}` })),
	],
])
</script>

<template>
	<UNavigationMenu :items="items" :collapsed="collapsed" orientation="vertical" />
</template>
