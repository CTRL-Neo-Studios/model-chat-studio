<script setup lang="ts">
import type { UIMessage } from 'ai'
import { getTextFromMessage } from '@nuxt/ui/utils/ai'

const props = withDefaults(defineProps<{
	message: UIMessage & { createdAt?: string | Date }
	streaming: boolean
	editing: boolean
	vote: boolean | null
	/** Off for answers of a model that was removed from the chat. */
	regenerable?: boolean
}>(), { regenerable: true })

const emit = defineEmits<{
	edit: [message: UIMessage]
	delete: [message: UIMessage]
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
	<template v-if="message.role === 'assistant' && !streaming && !editing">
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

		<UTooltip v-if="regenerable" text="Regenerate: write this answer again from what came before it. The rest of the chat stays, and the earlier answer is kept as a version.">
			<UButton
				size="sm"
				color="neutral"
				variant="ghost"
				icon="i-lucide-rotate-cw"
				aria-label="Regenerate response"
				@click="emit('regenerate', message)"
			/>
		</UTooltip>

		<UTooltip text="Edit response">
			<UButton
				size="sm"
				color="neutral"
				variant="ghost"
				icon="i-lucide-pencil"
				aria-label="Edit response"
				@click="emit('edit', message)"
			/>
		</UTooltip>

		<UTooltip text="Delete response">
			<UButton
				size="sm"
				color="neutral"
				variant="ghost"
				icon="i-lucide-trash"
				aria-label="Delete response"
				@click="emit('delete', message)"
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

		<UTooltip text="Delete message">
			<UButton
				size="sm"
				color="neutral"
				variant="ghost"
				icon="i-lucide-trash"
				aria-label="Delete message"
				@click="emit('delete', message)"
			/>
		</UTooltip>
	</template>
</template>
