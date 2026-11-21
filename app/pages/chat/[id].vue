<script setup lang="ts">
// Readable by guests when link access is on; the server decides who sees what.
definePageMeta({ auth: false })

const chatId = useRoute().params.id as string
// The page opens at once: a chat seen before, or hovered in the sidebar, renders from the cache; a new one
// shows placeholders until it arrives.
const { data, error } = useQuery(chatQuery(chatId))
</script>

<template>
	<ChatView v-if="data?.id" :chat-id="chatId" />

	<UContainer v-else-if="error" class="flex-1 flex flex-col gap-4 sm:gap-6">
		<UError :error="{ statusMessage: 'Chat not found', statusCode: 404 }" class="min-h-full" />
	</UContainer>

	<UContainer v-else class="flex-1 flex flex-col gap-6 pt-20" aria-busy="true" aria-label="Loading the chat">
		<USkeleton class="h-10 w-2/5 self-end rounded-lg" />
		<USkeleton class="h-28 w-full rounded-lg" />
		<USkeleton class="h-10 w-1/3 self-end rounded-lg" />
		<USkeleton class="h-20 w-full rounded-lg" />
	</UContainer>
</template>
