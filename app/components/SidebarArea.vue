<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

/** The sidebar of every area but chat: back to chat, then the area's pages (`AREAS`), grouped under their headings. */
const props = defineProps<{ area: Exclude<Area, 'chat'>, collapsed?: boolean }>()

const route = useRoute()
const { user } = useUserSession()
// Beside a page: the member's listings rejected or removed, and for reviewers what waits for them.
const { data: counts } = useQuery(exploreCountsQuery)
const badges = computed<Record<string, number | undefined>>(() => ({ '/content/published': counts.value?.attention, '/admin/review': counts.value?.waiting }))

const items = computed(() => {
	const groups: NavigationMenuItem[][] = [[{ label: 'Chat', icon: 'i-lucide-arrow-left', to: '/' }], []]
	for (const section of sectionsOf(props.area, user.value?.role)) {
		if (section.heading) groups.push([{ label: section.heading, type: 'label' }])
		groups.at(-1)!.push({
			label: section.label,
			icon: section.icon,
			to: section.to,
			// A row stays lit on the pages under it (a listing under Explore, a library under Libraries).
			active: section.exact ? route.path === section.to : isUnder(route.path, section.to),
			badge: badges.value[section.to] || undefined,
		})
	}
	return groups
})
</script>

<template>
	<UNavigationMenu :items="items" :collapsed="collapsed" orientation="vertical" />
</template>
