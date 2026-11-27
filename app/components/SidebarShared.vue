<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

/** Chats other people shared with the member by name, under their own; each row's menu says who and lets them leave. */
const { data } = useQuery(sharedChatsQuery)
type Shared = NonNullable<typeof data.value>[number]
const items = computed(() => data.value?.length
	? [
			{ label: 'Shared with me', type: 'label' as const },
			...data.value.map(chat => ({ label: chat.title || 'Untitled', to: `/chat/${chat.id}`, slot: 'shared' as const, chat, class: chat.title ? '' : 'text-muted' })),
		]
	: [])

// "Leave": the chat is no longer shared with the member; gone at once, back if the server refuses.
const act = useApiAction()
const queryCache = useQueryCache()
async function leave(chatId: string) {
	const before = data.value ?? []
	queryCache.setQueryData(sharedChatsQuery.key, before.filter(chat => chat.id !== chatId))
	if (!await act(`/api/v1/chats/${chatId}/shares/me`, { method: 'DELETE', success: 'You left the chat' })) queryCache.setQueryData(sharedChatsQuery.key, before)
}
const actions = (chat: Shared): DropdownMenuItem[][] => [
	[{ type: 'label', label: `${chat.owner.name || chat.owner.username} · ${chat.role === 'editor' ? 'you edit' : 'you read'}`, avatar: { src: chat.owner.avatarUrl || undefined, alt: chat.owner.username } }],
	[{ label: 'Leave', icon: 'i-lucide-log-out', color: 'error', onSelect: () => leave(chat.id) }],
]
</script>

<template>
	<UNavigationMenu
		v-if="items.length"
		:items="items"
		orientation="vertical"
		:ui="{
			link: 'overflow-hidden pr-7.5',
			linkTrailing: 'translate-x-full group-hover:translate-x-0 group-has-data-[state=open]:translate-x-0 transition-transform ms-0 absolute inset-e-px',
		}"
	>
		<template #shared-trailing="{ item }">
			<UDropdownMenu :items="actions(item.chat)" :content="{ align: 'end' }">
				<UButton
					as="div"
					icon="i-lucide-ellipsis"
					color="neutral"
					variant="link"
					size="sm"
					class="rounded-[5px] hover:bg-accented/50 focus-visible:bg-accented/50 data-[state=open]:bg-accented/50"
					aria-label="Shared chat actions"
					tabindex="-1"
					@click.stop.prevent
				/>
			</UDropdownMenu>
		</template>
	</UNavigationMenu>
</template>
