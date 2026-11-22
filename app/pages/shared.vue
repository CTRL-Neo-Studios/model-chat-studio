<script setup lang="ts">
import { formatDistanceToNow } from 'date-fns'

useHead({ title: 'Shared with me' })

const { data, isPending } = useQuery(sharedChatsQuery)
const chats = computed(() => data.value ?? [])
</script>

<template>
	<UDashboardPanel id="shared" class="min-h-0">
		<template #header>
			<UDashboardNavbar title="Shared with me" />
		</template>

		<template #body>
			<div class="w-full max-w-3xl mx-auto flex flex-col gap-4">
				<p class="text-sm text-muted">
					Chats other people shared with you by name. You can read them; only their owner writes in them.
				</p>
				<div v-if="isPending" class="flex flex-col gap-2" aria-busy="true" aria-label="Loading shared chats">
					<USkeleton v-for="n in 4" :key="n" class="h-14 w-full" />
				</div>
				<UEmpty
					v-else-if="!chats.length"
					icon="i-lucide-users"
					title="Nothing shared with you yet"
					description="When someone shares a chat with you, it shows here."
				/>
				<ul v-else class="flex flex-col divide-y divide-default rounded-md border border-default">
					<li v-for="chat in chats" :key="chat.id" class="relative flex items-center gap-3 px-4 py-3 hover:bg-elevated/50 has-focus-visible:ring-2 has-focus-visible:ring-primary">
						<UAvatar :src="chat.owner.avatarUrl || undefined" :alt="chat.owner.username" size="sm" />
						<div class="flex-1 min-w-0">
							<!-- The link covers the row. -->
							<NuxtLink :to="`/chat/${chat.id}`" class="block truncate font-medium outline-none after:absolute after:inset-0" :class="chat.title ? 'text-highlighted' : 'text-muted'">
								{{ chat.title || 'Untitled' }}
							</NuxtLink>
							<p class="text-xs text-muted truncate">
								{{ chat.owner.name || chat.owner.username }} · updated {{ formatDistanceToNow(new Date(chat.updatedAt), { addSuffix: true }) }}
							</p>
						</div>
					</li>
				</ul>
			</div>
		</template>
	</UDashboardPanel>
</template>
