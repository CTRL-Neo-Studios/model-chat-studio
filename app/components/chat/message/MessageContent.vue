<script setup lang="ts">
import { getToolName, isReasoningUIPart, isTextUIPart, isToolUIPart } from 'ai'
import type { UIMessage } from 'ai'
import { isPartStreaming } from '@nuxt/ui/utils/ai'
import type { ChartUIToolInvocation } from '#shared/utils/tools/chart'

defineProps<{
	message: UIMessage
	streaming: boolean
	editing: boolean
}>()

const emit = defineEmits<{
	save: [message: UIMessage, text: string]
	cancelEdit: []
}>()
</script>

<template>
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
					@save="(msg, text) => emit('save', msg, text)"
					@cancel="emit('cancelEdit')"
				/>
				<p v-else class="whitespace-pre-wrap">
					{{ part.text }}
				</p>
			</template>
		</template>
	</template>
</template>
