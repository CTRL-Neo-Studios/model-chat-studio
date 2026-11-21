<script setup lang="ts">
import type { UIMessage } from 'ai'

const props = defineProps<{
	message: UIMessage
	text: string
	/** Offers "Save and resend": the answers and everything after are dropped and the message is answered again. */
	resend?: boolean
}>()

const emit = defineEmits<{
	save: [message: UIMessage, text: string, resend: boolean]
	cancel: []
}>()

const editingText = ref(props.text)
</script>

<template>
	<div class="flex flex-col gap-2 w-full">
		<UTextarea
			v-model="editingText"
			autofocus
			autoresize
			:rows="1"
			size="xl"
			variant="none"
			:ui="{ base: 'p-0' }"
		/>

		<div class="flex gap-1.5 justify-end">
			<UButton size="sm" variant="soft" color="neutral" label="Cancel" @click="emit('cancel')" />
			<UButton
				size="sm"
				:variant="resend ? 'soft' : 'solid'"
				label="Save"
				:disabled="!editingText.trim() || editingText === text"
				@click="emit('save', message, editingText, false)"
			/>
			<UButton
				v-if="resend"
				size="sm"
				label="Save and resend"
				:disabled="!editingText.trim()"
				@click="emit('save', message, editingText, true)"
			/>
		</div>
	</div>
</template>
