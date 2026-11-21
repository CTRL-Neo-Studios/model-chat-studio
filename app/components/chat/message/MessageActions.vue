<script setup lang="ts">
import type { UIMessage } from 'ai'
import { getTextFromMessage } from '@nuxt/ui/utils/ai'

const props = defineProps<{
	message: UIMessage & { createdAt?: string | Date }
	streaming: boolean
	editing: boolean
	vote: boolean | null
}>()

const emit = defineEmits<{
	edit: [message: UIMessage]
	regenerate: [message: UIMessage]
	vote: [message: UIMessage, isUpvoted: boolean]
}>()

const formattedDate = computed(() => {
	if (!props.message.createdAt) return null
	const date = new Date(props.message.createdAt)
	return {
		time: date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
		full: date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
		iso: date.toISOString(),
	}
})

const { copy, copied } = useClipboard({ copiedDuring: 2000 })
</script>

<template>
	<template v-if="message.role === 'assistant' && !streaming">
		<UTooltip text="Copy response">
			<UButton
				size="sm"
				:color="copied ? 'primary' : 'neutral'"
				variant="ghost"
				:icon="copied ? 'i-lucide-copy-check' : 'i-lucide-copy'"
				aria-label="Copy response"
				@click="copy(getTextFromMessage(message))"
			/>
		</UTooltip>

		<UTooltip text="Good response">
			<UButton
				size="sm"
				:color="vote === true ? 'success' : 'neutral'"
				variant="ghost"
				icon="i-lucide-thumbs-up"
				aria-label="Good response"
				@click="emit('vote', message, true)"
			/>
		</UTooltip>

		<UTooltip text="Bad response">
			<UButton
				size="sm"
				:color="vote === false ? 'error' : 'neutral'"
				variant="ghost"
				icon="i-lucide-thumbs-down"
				aria-label="Bad response"
				@click="emit('vote', message, false)"
			/>
		</UTooltip>

		<UTooltip text="Regenerate response">
			<UButton
				size="sm"
				color="neutral"
				variant="ghost"
				icon="i-lucide-rotate-cw"
				aria-label="Regenerate response"
				@click="emit('regenerate', message)"
			/>
		</UTooltip>
	</template>

	<template v-if="message.role === 'user' && !streaming && !editing">
		<UTooltip v-if="formattedDate" :text="formattedDate.full">
			<time :datetime="formattedDate.iso" class="text-xs text-muted mr-1.5">
				{{ formattedDate.time }}
			</time>
		</UTooltip>

		<!-- The editor only edits text; a message with attachments is regenerated instead. -->
		<UTooltip v-if="!message.parts.some(part => part.type === 'file')" text="Edit message">
			<UButton
				size="sm"
				color="neutral"
				variant="ghost"
				icon="i-lucide-pencil"
				aria-label="Edit message"
				@click="emit('edit', message)"
			/>
		</UTooltip>
	</template>
</template>
