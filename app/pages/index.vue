<script setup lang="ts">
const input = ref('')
const loading = ref(false)
const chatId = crypto.randomUUID()

const { user } = useUserSession()
const toast = useToast()
const { csrf, headerName } = useCsrf()

// Until an admin picks a platform and a key, there is nothing to send to.
const { ready, platform } = useModels()
await ready
const unavailable = computed(() => !platform.value)

const { params, systemPrompt } = useChatSettings()
const isAdmin = computed(() => user.value?.role === 'admin')

const greeting = computed(() => {
	const hour = new Date().getHours()
	const timeGreeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
	const name = user.value?.name?.split(' ')[0] || user.value?.username
	return name ? `${timeGreeting}, ${name}` : timeGreeting
})

// Files upload to the new chat's id before the chat exists; creating it links them to the first message.
const { uploads, promptFiles, uploading, parts: fileParts } = usePromptUploads(chatId)

async function createChat(prompt: string) {
	if ((!prompt.trim() && !fileParts.value.length) || uploading.value || loading.value) return
	input.value = prompt
	loading.value = true
	try {
		await $fetch('/api/v1/chats', {
			method: 'POST',
			headers: { [headerName]: csrf },
			body: {
				id: chatId,
				message: { id: crypto.randomUUID(), role: 'user', parts: [...(prompt.trim() ? [{ type: 'text', text: prompt }] : []), ...fileParts.value] },
				params: params.value,
				systemPrompt: systemPrompt.value || undefined,
			},
		})
	}
	catch {
		loading.value = false
		toast.add({ description: 'Failed to start the chat', icon: 'i-lucide-alert-circle', color: 'error' })
		return
	}
	refreshNuxtData('chats')
	await navigateTo(`/chat/${chatId}`)
}

const quickChats = [
	{ label: 'Explain a concept simply', icon: 'i-lucide-lightbulb' },
	{ label: 'Help me write a Vue composable', icon: 'i-lucide-code' },
	{ label: 'Summarize the pros and cons of SQL vs NoSQL', icon: 'i-lucide-scale' },
	{ label: 'Show me a chart of sample sales data', icon: 'i-lucide-line-chart' },
]
</script>

<template>
	<UDashboardPanel id="home" class="min-h-0" :ui="{ body: 'p-0 sm:p-0' }">
		<template #header>
			<Navbar />
		</template>

		<template #body>
			<div class="flex flex-1">
				<UContainer class="flex-1 flex flex-col justify-center gap-4 sm:gap-6 py-8">
					<h1 class="text-3xl sm:text-4xl text-highlighted font-bold">
						{{ greeting }}
					</h1>

					<UAlert
						v-if="unavailable"
						color="warning"
						variant="subtle"
						icon="i-lucide-plug-zap"
						title="Chat is not set up yet"
						:description="isAdmin ? 'Choose a model platform and add its API key in the admin settings.' : 'An admin needs to choose a model platform first.'"
					/>

					<ChatPrompt
						v-model="input"
						v-model:params="params"
						v-model:system-prompt="systemPrompt"
						v-model:files="promptFiles"
						:uploads="uploads"
						:uploading="uploading"
						:disabled="loading || unavailable"
						class="[view-transition-name:chat-prompt]"
						@submit="createChat(input)"
					/>

					<div class="flex flex-wrap gap-2">
						<UButton
							v-for="quickChat in quickChats"
							:key="quickChat.label"
							:icon="quickChat.icon"
							:label="quickChat.label"
							:disabled="loading || unavailable"
							size="sm"
							color="neutral"
							variant="outline"
							class="rounded-full"
							@click="createChat(quickChat.label)"
						/>
					</div>
				</UContainer>
			</div>
		</template>
	</UDashboardPanel>
</template>
