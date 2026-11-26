<script setup lang="ts">
/** "Export…": a chat as a chat file (every branch and version, to import again) or as Markdown (the branch shown, to read). */
const props = defineProps<{ chatId: string }>()
const emit = defineEmits<{ close: [] }>()

const format = ref<'json' | 'markdown'>('json')
const files = ref(false)
const FORMATS = [
	{ label: 'Chat file (JSON)', description: 'Everything: every branch and version, to import here or elsewhere.', value: 'json' },
	{ label: 'Markdown', description: 'The branch that shows, as a document to read. Cannot be imported.', value: 'markdown' },
]
const href = computed(() => `/api/v1/chats/${props.chatId}/export?format=${format.value}${format.value === 'json' && files.value ? '&files=true' : ''}`)
</script>

<template>
	<UModal title="Export chat" :ui="{ footer: 'flex-row-reverse justify-start' }" :close="false">
		<template #body>
			<div class="flex flex-col gap-4">
				<URadioGroup v-model="format" :items="FORMATS" />
				<UCheckbox
					v-if="format === 'json'"
					v-model="files"
					label="Include attachments"
					description="Images and files go inside the chat file, which can then be large. Without them, only their names."
				/>
			</div>
		</template>

		<template #footer>
			<UButton label="Download" icon="i-lucide-download" :to="href" external download @click="emit('close')" />
			<UButton color="neutral" variant="ghost" label="Cancel" @click="emit('close')" />
		</template>
	</UModal>
</template>
