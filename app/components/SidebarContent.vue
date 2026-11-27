<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

/** The content area's sidebar: back to chat, Explore and stars, then what the member made and published. */
defineProps<{ collapsed?: boolean }>()

const route = useRoute()
const { user } = useUserSession()
const { data: counts } = useQuery(exploreCountsQuery)
const staff = computed(() => getRoleLevel(user.value?.role) >= getRoleLevel('moderator'))
// A row stays lit on the pages under it (a listing under Explore, a library under Libraries).
const row = (label: string, icon: string, to: string, badge?: number): NavigationMenuItem => ({ label, icon, to, active: isUnder(route.path, to), badge: badge || undefined })

const items = computed<NavigationMenuItem[][]>(() => [
	[{ label: 'Chat', icon: 'i-lucide-arrow-left', to: '/' }],
	[
		{ label: 'Overview', icon: 'i-lucide-layout-grid', to: '/content', active: route.path === '/content' },
		row('Explore', 'i-lucide-telescope', '/content/explore'),
		row('Your stars', 'i-lucide-star', '/content/stars'),
	],
	[
		{ label: 'My content', type: 'label' },
		row('Characters', 'i-lucide-drama', '/content/characters'),
		row('Libraries', 'i-lucide-library-big', '/content/libraries'),
		row('Structure profiles', 'i-lucide-layers', '/content/structure-profiles'),
		row('Published', 'i-lucide-send', '/content/published', counts.value?.attention),
		...(staff.value ? [row('Review', 'i-lucide-shield-check', '/admin/review', counts.value?.waiting)] : []),
	],
])
</script>

<template>
	<UNavigationMenu :items="items" :collapsed="collapsed" orientation="vertical" />
</template>
