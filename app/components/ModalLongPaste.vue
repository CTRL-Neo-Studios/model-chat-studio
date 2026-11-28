<script setup lang="ts">
/** A long paste: into the prompt as text, or attached as a text file. Closing it pastes nothing. */
const props = defineProps<{
	text: string
}>()

const emit = defineEmits<{ close: ['text' | 'file' | undefined] }>()

const characters = computed(() => props.text.length.toLocaleString())
</script>

<template>
	<UModal
		:title="`Paste ${characters} characters`"
		description="Long text can go into the prompt, or be attached as a text file the models read."
		:ui="{ footer: 'flex-row-reverse justify-start' }"
		@update:open="open => !open && emit('close', undefined)"
	>
		<template #body>
			<pre class="max-h-60 overflow-y-auto whitespace-pre-wrap break-words text-xs text-muted rounded-md border border-default p-3">{{ text.slice(0, 1200) }}{{ text.length > 1200 ? '…' : '' }}</pre>
		</template>
		<template #footer>
			<UButton label="Paste as text" icon="i-lucide-clipboard-paste" @click="emit('close', 'text')" />
			<UButton label="Attach as a file" icon="i-lucide-file-text" color="neutral" variant="subtle" @click="emit('close', 'file')" />
			<UButton label="Cancel" color="neutral" variant="ghost" @click="emit('close', undefined)" />
		</template>
	</UModal>
</template>
