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
	/** Every version's id when the answer has several, oldest first. */
	versions?: string[]
	/** Something in the chat is being written: versions do not switch meanwhile. */
	busy: boolean
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
	/** Show another version of this answer. */
	show: [id: string]
}>()

const streaming = computed(() => props.pending?.status === 'streaming')
const writing = computed(() => props.pending?.status === 'submitted' || streaming.value)
// A group speaker still waiting for its turn in the round.
const queued = computed(() => props.pending?.status === 'queued')
const versionIndex = computed(() => props.versions?.indexOf(props.message?.id ?? '') ?? -1)
</script>

<template>
	<div :class="card ? 'flex flex-col min-w-0 rounded-lg border border-default bg-default' : 'flex flex-col min-w-0'">
		<div v-if="card" class="flex items-center gap-2 h-10 px-3 border-b border-default">
			<span :class="['size-2.5 rounded-full shrink-0', label.color ? LANE_COLOR_CLASSES[label.color] : 'border border-dashed border-accented']" />
			<span class="text-sm font-medium text-highlighted truncate">{{ label.name }}</span>
			<UButton
				v-if="(writing || queued) && isOwner"
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
			<!-- Until the first text arrives; the answer starts (empty) before the platform replies, e.g. while a call is retried. -->
			<div v-if="writing && !message?.parts.length" class="flex items-center gap-1.5 py-1">
				<ChatIndicator />
				<UChatShimmer text="Thinking..." class="text-sm" />
			</div>
			<p v-else-if="queued && !message" class="py-1 text-sm text-muted">
				Answers after the ones above
			</p>

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
			<!-- The answer's versions, oldest first; the version shown is the one the models read from then on. -->
			<div v-if="versions && versions.length > 1 && !writing && !editing" class="flex items-center text-xs text-muted tabular-nums">
				<UButton icon="i-lucide-chevron-left" size="xs" color="neutral" variant="ghost" aria-label="Earlier version" :disabled="busy || versionIndex === 0" @click="emit('show', versions[versionIndex - 1]!)" />
				<span :aria-label="`Version ${versionIndex + 1} of ${versions.length}`">{{ versionIndex + 1 }}/{{ versions.length }}</span>
				<UButton icon="i-lucide-chevron-right" size="xs" color="neutral" variant="ghost" aria-label="Later version" :disabled="busy || versionIndex === versions.length - 1" @click="emit('show', versions[versionIndex + 1]!)" />
			</div>
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
