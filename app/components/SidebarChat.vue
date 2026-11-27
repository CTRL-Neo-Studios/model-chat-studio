<script setup lang="ts">
import type { UIChat } from '~/composables/useChats'

/** The chat area's sidebar: starting chats, "Content", the member's folders and chats, and what others shared with them. */
defineProps<{
	collapsed?: boolean
	chats: UIChat[]
}>()
const emit = defineEmits<{ search: [] }>()

const { importChat } = useChatActions()
// Beside "Content": the member's listings rejected or removed, and for reviewers what waits for them.
const { data: counts } = useQuery(exploreCountsQuery)
const contentCount = computed(() => (counts.value?.attention ?? 0) + (counts.value?.waiting ?? 0))
</script>

<template>
	<UNavigationMenu
		:items="[{
			label: 'New chat',
			to: '/',
			kbds: ['meta', 'o'],
			icon: 'i-lucide-circle-plus',
		}, {
			label: 'Temporary chat',
			to: '/temporary',
			icon: 'i-lucide-ghost',
		}, {
			label: 'Import chat…',
			icon: 'i-lucide-file-up',
			onSelect: () => importChat(),
		}, {
			label: 'Search',
			icon: 'i-lucide-search',
			kbds: ['meta', 'k'],
			onSelect: () => emit('search'),
		}, {
			label: 'Content',
			to: '/content',
			icon: 'i-lucide-shapes',
			count: contentCount,
		}]"
		:collapsed="collapsed"
		orientation="vertical"
	>
		<template #item-trailing="{ item }">
			<div v-if="item.kbds?.length" class="flex items-center gap-px opacity-0 group-hover:opacity-100 transition-opacity">
				<UKbd
					v-for="kbd in item.kbds"
					:key="kbd"
					:value="kbd"
					size="sm"
					variant="soft"
					class="bg-accented/50"
				/>
			</div>
			<UBadge v-else-if="item.count" :label="String(item.count)" size="sm" variant="subtle" :aria-label="`${item.count} in your content need you`" />
		</template>
	</UNavigationMenu>

	<template v-if="!collapsed">
		<SidebarChats :chats="chats" />
		<SidebarShared />
	</template>
</template>
