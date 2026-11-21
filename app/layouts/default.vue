<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

const { loggedIn } = useUserSession()
const { renameChat, deleteChat } = useChatActions()
const queryCache = useQueryCache()
const siteName = useRuntimeConfig().public.siteName as string || 'Chat'

const sidebarOpen = ref(false)
const searchOpen = ref(false)

// Guests only ever see a chat shared by link, so they have no list.
const { data: chatList } = useQuery(() => ({ ...chatsQuery, enabled: loggedIn.value }))
const chats = computed(() => loggedIn.value
	? (chatList.value ?? []).map(chat => ({
			id: chat.id,
			label: chat.title || 'Untitled',
			to: `/chat/${chat.id}`,
			icon: 'i-lucide-message-circle',
			createdAt: chat.createdAt,
		}))
	: [])

/** Loads data the member is about to need, unless it is cached and fresh. */
function prefetch(options: Parameters<typeof queryCache.ensure>[0]) {
	queryCache.refresh(queryCache.ensure(options)).catch(() => {})
}

watch(loggedIn, () => {
	sidebarOpen.value = false
})
// The model picker and the profiles appear on most pages; load them once signed in.
if (import.meta.client) {
	watch(loggedIn, (value) => {
		if (value) [modelsQuery, modelProfilesQuery].forEach(prefetch)
	}, { immediate: true })
}

// A chat loads while the pointer is over its link or the link has focus, so opening it is instant.
function prefetchChat(event: Event) {
	const link = event.target instanceof Element ? event.target.closest('a') : null
	const id = link?.getAttribute('href')?.match(/^\/chat\/([\w-]+)$/)?.[1]
	if (id) prefetch(chatQuery(id))
}

const { groups } = useChats(chats)

const items = computed(() => groups.value.flatMap(group => [
	{ label: group.label, type: 'label' as const },
	...group.items.map(item => ({
		...item,
		slot: 'chat' as const,
		icon: undefined,
		class: item.label === 'Untitled' ? 'text-muted' : '',
	})),
]))

function getChatActions(item: { id: string, label: string }): DropdownMenuItem[][] {
	return [[
		{ label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => renameChat(item.id, item.label === 'Untitled' ? '' : item.label) },
	], [
		{ label: 'Delete', icon: 'i-lucide-trash', color: 'error', onSelect: () => deleteChat(item.id) },
	]]
}

defineShortcuts({
	meta_o: () => navigateTo('/'),
})
</script>

<template>
	<UDashboardGroup unit="rem">
		<UDashboardSidebar
			id="default"
			v-model:open="sidebarOpen"
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
						label: 'Search',
						icon: 'i-lucide-search',
						kbds: ['meta', 'k'],
						onSelect: () => {
							searchOpen = true
						},
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

				<UNavigationMenu
					v-if="!collapsed"
					:items="items"
					:collapsed="collapsed"
					orientation="vertical"
					:ui="{
						link: 'overflow-hidden pr-7.5',
						linkTrailing: 'translate-x-full group-hover:translate-x-0 group-has-data-[state=open]:translate-x-0 transition-transform ms-0 absolute inset-e-px',
					}"
					@pointerover="prefetchChat"
					@focusin="prefetchChat"
				>
					<template #chat-trailing="{ item }">
						<UDropdownMenu
							:items="getChatActions(item as { id: string, label: string })"
							:content="{ align: 'end' }"
						>
							<UButton
								as="div"
								icon="i-lucide-ellipsis"
								color="neutral"
								variant="link"
								size="sm"
								class="rounded-[5px] hover:bg-accented/50 focus-visible:bg-accented/50 data-[state=open]:bg-accented/50"
								aria-label="Chat actions"
								tabindex="-1"
								@click.stop.prevent
							/>
						</UDropdownMenu>
					</template>
				</UNavigationMenu>
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
