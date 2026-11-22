<script setup lang="ts">
// Readable by guests when link access is on; the server decides who sees what.
definePageMeta({ auth: false })

const chatId = useRoute().params.id as string
// Set by the home page for a chat it just created.
const firstAnswer = !!useRouter().options.history.state.firstAnswer
// Rendered by the server with its data (as is a library): chats are opened from links and bookmarks, by guests too,
// and the conversation is the page. The server reads it through the API with the visitor's cookie, so the page
// holds no more than the API gives them. In the app, a chat seen before or hovered in the sidebar renders from the cache.
const { data, error } = useQuery({ ...chatQuery(chatId), enabled: true })
</script>

<template>
	<ChatView v-if="data?.id" :chat-id="chatId" :first-answer="firstAnswer" />

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
