<script setup lang="ts">
useHead({ title: 'Temporary chat' })

// The chat's id never reaches the URL, so a refresh starts a new one. Leaving deletes it: `pagehide` covers a
// refresh, closing the tab and going to another site page (`keepalive` lets the request outlive the page), the
// route guard covers moving within the app. A tab that dies without either is swept by the server after 24 h.
const chatId = ref<string | null>(null)
const kept = ref(false)
const queryCache = useQueryCache()
const { csrf, headerName } = useCsrf()

async function open(id: string) {
	await queryCache.refresh(queryCache.ensure(chatQuery(id)))
	chatId.value = id
}

function discard() {
	const id = chatId.value
	if (!id || kept.value) return
	chatId.value = null
	fetch(`/api/v1/chats/${id}`, { method: 'DELETE', keepalive: true, headers: { [headerName]: csrf } }).catch(() => {})
}

function onKept() {
	kept.value = true
	navigateTo(`/chat/${chatId.value}`, { replace: true })
}

onMounted(() => window.addEventListener('pagehide', discard))
onBeforeUnmount(() => window.removeEventListener('pagehide', discard))
onBeforeRouteLeave(discard)
</script>

<template>
	<ChatView v-if="chatId" :key="chatId" :chat-id="chatId" first-answer @kept="onKept" />
	<NewChat v-else temporary @created="open" />
</template>
