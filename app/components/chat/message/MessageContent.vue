<script setup lang="ts">
import { getToolName, isReasoningUIPart, isTextUIPart, isToolUIPart } from 'ai'
import type { UIMessage } from 'ai'
import { getTextFromMessage, isPartStreaming } from '@nuxt/ui/utils/ai'
import type { ChartUIToolInvocation } from '#shared/utils/tools/chart'
import type { MessageMetadata } from '#shared/utils/chat'

const props = defineProps<{
	message: UIMessage
	streaming: boolean
	editing: boolean
}>()

const metadata = computed(() => props.message.metadata as MessageMetadata | null | undefined)

const FILE_TOOL_LABELS: Record<string, string> = { list_files: 'Listed the library\'s files', search_files: 'Searched the library for', read_file: 'Read' }
/** "Read docs/plan.md", "Searched the library for “budget”", from a file tool's input as far as it has arrived. */
function fileToolLine(name: string, input: unknown) {
	const value = (key: string) => typeof input === 'object' && input !== null && key in input ? String(Reflect.get(input, key)) : ''
	if (name === 'read_file') return `${FILE_TOOL_LABELS.read_file} ${value('path')}`
	if (name === 'search_files') return `${FILE_TOOL_LABELS.search_files} “${value('query')}”`
	return value('folder') ? `${FILE_TOOL_LABELS.list_files} in ${value('folder')}` : FILE_TOOL_LABELS.list_files
}

const emit = defineEmits<{
	save: [message: UIMessage, text: string, resend: boolean]
	cancelEdit: []
}>()
</script>

<template>
	<!-- The safety check withheld this answer; whatever streamed before is not shown. -->
	<UAlert
		v-if="metadata?.refused"
		icon="i-lucide-shield-alert"
		color="warning"
		variant="subtle"
		title="Answer withheld"
		description="This answer was withheld by the content safety check."
	/>
	<!-- An answer's text is edited as one piece; its reasoning, sources and charts stay as they are. -->
	<ChatMessageEdit
		v-else-if="editing && message.role === 'assistant'"
		:message="message"
		:text="getTextFromMessage(message)"
		@save="(msg, text) => emit('save', msg, text, false)"
		@cancel="emit('cancelEdit')"
	/>
	<template v-else>
		<template v-for="(part, index) in getMergedParts(message.parts)" :key="`${message.id}-${part.type}-${index}`">
			<UChatReasoning
				v-if="isReasoningUIPart(part) && message.role === 'assistant'"
				:text="part.text"
				:streaming="isPartStreaming(part, streaming)"
				chevron="leading"
			>
				<ChatComark :value="part.text" :streaming="isPartStreaming(part, streaming)" />
			</UChatReasoning>

			<ChatToolChart
				v-else-if="isToolUIPart(part) && getToolName(part) === 'chart'"
				:invocation="{ ...(part as ChartUIToolInvocation) }"
			/>

			<!-- The library file tools: one quiet line per call. -->
			<p
				v-else-if="isToolUIPart(part) && FILE_TOOL_LABELS[getToolName(part)]"
				class="flex items-center gap-1.5 text-xs text-muted min-w-0"
			>
				<UIcon :name="part.state.startsWith('output') ? 'i-lucide-folder-search' : 'i-lucide-loader-circle'" :class="['size-3.5 shrink-0', !part.state.startsWith('output') && 'animate-spin']" />
				<span class="truncate">{{ fileToolLine(getToolName(part), part.input) }}</span>
			</p>

			<template v-else-if="isTextUIPart(part)">
				<ChatComark
					v-if="message.role === 'assistant'"
					:value="part.text"
					:streaming="isPartStreaming(part, streaming)"
				/>
				<template v-else-if="message.role === 'user'">
					<ChatMessageEdit
						v-if="editing"
						:message="message"
						:text="part.text"
						resend
						@save="(msg, text, resend) => emit('save', msg, text, resend)"
						@cancel="emit('cancelEdit')"
					/>
					<p v-else class="whitespace-pre-wrap">
						{{ part.text }}
					</p>
				</template>
			</template>
		</template>
	</template>
	<ChatMessageFooter v-if="message.role === 'assistant' && metadata && !streaming" :metadata="metadata" />
</template>
