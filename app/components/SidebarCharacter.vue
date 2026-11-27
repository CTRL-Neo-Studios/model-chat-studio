<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

/** Inside a Character: back to the list, then its sections; each is the same page with `?section=`, so a draft stays. */
defineProps<{ collapsed?: boolean }>()

const route = useRoute()
const { data: characters } = useQuery(charactersQuery)
const name = computed(() => route.params.id === 'new' ? 'New Character' : characters.value?.find(entry => entry.id === route.params.id)?.name ?? '')
const current = computed(() => characterSectionOf(route.query.section))

const items = computed<NavigationMenuItem[][]>(() => [
	[{ label: 'Characters', icon: 'i-lucide-arrow-left', to: '/content/characters' }],
	[
		{ label: name.value, type: 'label' },
		...CHARACTER_SECTIONS.map(section => ({
			label: section.label,
			icon: section.icon,
			to: { path: route.path, query: { ...route.query, section: section.value } },
			active: current.value === section.value,
		})),
	],
])
</script>

<template>
	<UNavigationMenu :items="items" :collapsed="collapsed" orientation="vertical" />
</template>
