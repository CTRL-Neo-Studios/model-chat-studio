<script setup lang="ts">
import type { UIMessage } from 'ai'
import type { LaneColor } from '#shared/utils/chat'
import type { ChatMessage, PendingAnswer } from '~/composables/useLaneAnswers'

/** One model's answer to a message: as a card with the model's label when several answer, or plain. */
const props = defineProps<{
	label: { name: string, color: LaneColor | null }
	message?: ChatMessage
	pending?: PendingAnswer
	card: boolean
	isOwner: boolean
	editing: boolean
	vote: boolean | null
	/** Off for answers of a model that was removed from the chat. */
	regenerable: boolean
}>()

const emit = defineEmits<{
	regenerate: []
	stop: []
	dismiss: []
	edit: [message: UIMessage]
	delete: [message: UIMessage]
	vote: [message: UIMessage, isUpvoted: boolean]
	save: [message: UIMessage, text: string, resend: boolean]
	cancelEdit: []
}>()

const streaming = computed(() => props.pending?.status === 'streaming')
const writing = computed(() => props.pending?.status === 'submitted' || streaming.value)
</script>

<template>
	<div :class="card ? 'flex flex-col min-w-0 rounded-lg border border-default bg-default' : 'flex flex-col min-w-0'">
		<div v-if="card" class="flex items-center gap-2 h-10 px-3 border-b border-default">
			<span :class="['size-2.5 rounded-full shrink-0', label.color ? LANE_COLOR_CLASSES[label.color] : 'border border-dashed border-accented']" />
			<span class="text-sm font-medium text-highlighted truncate">{{ label.name }}</span>
			<UButton
				v-if="writing && isOwner"
				icon="i-lucide-square"
				size="xs"
				color="neutral"
				variant="ghost"
				class="ms-auto"
				aria-label="Stop this answer"
				@click="emit('stop')"
			/>
		</div>

		<div :class="card ? 'px-3 py-2 min-w-0' : 'min-w-0'">
			<div v-if="!message && pending?.status === 'submitted'" class="flex items-center gap-1.5 py-1">
				<ChatIndicator />
				<UChatShimmer text="Thinking..." class="text-sm" />
			</div>

			<ChatMessageContent
				v-if="message"
				:message="message"
				:streaming="streaming"
				:editing="editing"
				@save="(msg, text, resend) => emit('save', msg, text, resend)"
				@cancel-edit="emit('cancelEdit')"
			/>

			<UAlert
				v-if="pending?.status === 'error'"
				:title="message ? 'The new answer failed; this is the earlier one.' : 'This model could not answer.'"
				:description="pending.error"
				icon="i-lucide-alert-circle"
				color="error"
				variant="subtle"
				class="mt-2"
				:actions="isOwner ? [{ label: 'Retry', color: 'error', variant: 'solid', size: 'xs', onClick: () => emit('regenerate') }, { label: 'Dismiss', color: 'error', variant: 'link', size: 'xs', onClick: () => emit('dismiss') }] : undefined"
			/>
		</div>

		<div v-if="isOwner && message" :class="['flex items-center gap-0.5', card ? 'px-1.5 pb-1.5' : 'mt-1 -ms-1.5']">
			<ChatMessageActions
				:message="message"
				:streaming="writing"
				:editing="editing"
				:vote="vote"
				:regenerable="regenerable"
				@vote="(msg, up) => emit('vote', msg, up)"
				@edit="msg => emit('edit', msg)"
				@delete="msg => emit('delete', msg)"
				@regenerate="emit('regenerate')"
			/>
		</div>
	</div>
</template>
