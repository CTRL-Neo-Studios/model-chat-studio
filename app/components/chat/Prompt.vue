<script setup lang="ts">
import type { ChatStatus } from 'ai'

// ponytail: attachments and dictation arrive in phase 7, the model picker and chat settings in phase 6.
withDefaults(defineProps<{
	status?: ChatStatus
	error?: Error
	disabled?: boolean
}>(), {
	status: 'ready',
	error: undefined,
})

const emit = defineEmits<{
	submit: [event: Event]
	stop: []
	reload: []
}>()

const input = defineModel<string>({ default: '' })
</script>

<template>
	<UChatPrompt
		v-model="input"
		:status="status"
		:error="error"
		:disabled="disabled"
		color="neutral"
		variant="subtle"
		:ui="{ base: 'px-1.5' }"
		@submit="emit('submit', $event)"
	>
		<template #footer>
			<div />
			<UChatPromptSubmit
				:status="status"
				:disabled="disabled"
				color="neutral"
				size="sm"
				@stop="emit('stop')"
				@reload="emit('reload')"
			/>
		</template>
	</UChatPrompt>
</template>
