<script setup lang="ts">
const { loggedIn } = useUserSession()
const siteName = useRuntimeConfig().public.siteName as string || 'Chat'

const sidebarOpen = ref(false)
const searchOpen = ref(false)

// Guests only ever see a chat shared by link, so they have no list.
const { data: chatList } = useQuery(() => ({ ...chatsQuery, enabled: import.meta.client && loggedIn.value }))
const chats = computed(() => loggedIn.value ? (chatList.value ?? []).map(toUIChat) : [])

const prefetch = usePrefetch()

watch(loggedIn, () => {
	sidebarOpen.value = false
})
// The model picker and the profiles appear on most pages; load them once signed in. What the menus lead to loads
// once the first page is up and the browser idle, so a click there shows its data without a skeleton.
if (import.meta.client) {
	watch(loggedIn, (value) => {
		if (value) prefetch(modelsQuery, modelProfilesQuery)
	}, { immediate: true })
	onNuxtReady(() => watch(loggedIn, (value) => {
		if (value) prefetch(librariesQuery, charactersQuery, structureProfilesQuery, sharedChatsQuery, meQuery, usageQuery)
	}, { immediate: true }))
}

// Search covers every chat, in folders or not.
const { groups } = useChats(chats)

// A temporary chat starts with the sidebar collapsed; leaving it restores the sidebar as it was. The state before
// is kept in a cookie, since the sidebar saves its own state and a reload of the temporary chat would otherwise
// take the forced collapse for the member's choice. Applied after mount, once the sidebar has read its state.
const route = useRoute()
const sidebarCollapsed = ref(false)
const collapsedBefore = useCookie<boolean | null>('sidebar-before-temporary', { default: () => null, sameSite: 'lax' })
onMounted(() => watch(() => route.path === '/temporary', (temporary) => {
	if (temporary) {
		collapsedBefore.value ??= sidebarCollapsed.value
		sidebarCollapsed.value = true
	}
	else if (collapsedBefore.value !== null) {
		sidebarCollapsed.value = collapsedBefore.value
		collapsedBefore.value = null
	}
}, { immediate: true }))

defineShortcuts({
	meta_o: () => navigateTo('/'),
})
</script>

<template>
	<UDashboardGroup unit="rem">
		<UDashboardSidebar
			id="default"
			v-model:open="sidebarOpen"
			v-model:collapsed="sidebarCollapsed"
			:min-size="12"
			collapsible
			resizable
			:menu="{ inset: true }"
			class="border-r-0 py-4 dark:[--ui-bg-elevated:var(--ui-color-neutral-900)]"
		>
			<template #header="{ collapsed }">
				<NuxtLink
					v-if="!collapsed"
					to="/"
					class="flex items-center outline-primary/25 focus-visible:outline-3 rounded-md px-1"
				>
					<span class="text-xl font-bold text-highlighted truncate">{{ siteName }}</span>
				</NuxtLink>

				<UDashboardSidebarCollapse class="ms-auto" />
			</template>

			<template #default="{ collapsed }">
				<UNavigationMenu
					v-if="loggedIn"
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
						label: 'Libraries',
						to: '/libraries',
						icon: 'i-lucide-library-big',
					}, {
						label: 'Search',
						icon: 'i-lucide-search',
						kbds: ['meta', 'k'],
						onSelect: () => {
							searchOpen = true
						},
					}, {
						label: 'Shared with me',
						to: '/shared',
						icon: 'i-lucide-users',
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
					</template>
				</UNavigationMenu>

				<SidebarChats v-if="loggedIn && !collapsed" :chats="chats" />
			</template>

			<template #footer="{ collapsed }">
				<UserMenu v-if="loggedIn" :collapsed="collapsed" />
				<UButton
					v-else
					:label="collapsed ? '' : 'Sign in'"
					icon="i-lucide-log-in"
					color="neutral"
					variant="ghost"
					class="w-full"
					to="/signin"
				/>
			</template>
		</UDashboardSidebar>

		<UDashboardSearch
			v-if="loggedIn"
			v-model:open="searchOpen"
			placeholder="Search chats..."
			:groups="[{
				id: 'links',
				items: [{ label: 'New chat', to: '/', icon: 'i-lucide-circle-plus', kbds: ['meta', 'o'] }],
			}, ...groups]"
		/>

		<div class="flex-1 flex m-4 lg:ml-0 rounded-lg ring ring-default bg-default/75 shadow-sm min-w-0 overflow-hidden">
			<slot />
		</div>
	</UDashboardGroup>
</template>
