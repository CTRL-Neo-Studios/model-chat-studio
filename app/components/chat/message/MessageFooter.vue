<script setup lang="ts">
import type { MessageMetadata } from '#shared/utils/chat'

const props = defineProps<{
	metadata: MessageMetadata
}>()

const { models } = useModels()

// Model, provider, tokens and cost, as far as the platform reported them.
const parts = computed(() => {
	const { model, provider, inputTokens, outputTokens, reasoningTokens, costUsd } = props.metadata
	return [
		models.value.find(entry => entry.id === model)?.name ?? model,
		provider,
		inputTokens !== undefined && outputTokens !== undefined && `${formatTokens(inputTokens)} in · ${formatTokens(outputTokens)} out`,
		reasoningTokens ? `${formatTokens(reasoningTokens)} reasoning` : undefined,
		typeof costUsd === 'number' ? formatUsd(costUsd) : undefined,
	].filter(Boolean)
})

const tooltip = computed(() => {
	const { cachedInputTokens, costUsd } = props.metadata
	return [
		cachedInputTokens ? `${cachedInputTokens.toLocaleString('en-US')} input tokens from cache` : undefined,
		costUsd === null ? 'Cost unknown' : undefined,
	].filter(Boolean).join(' · ')
})
</script>

<template>
	<UTooltip :text="tooltip" :disabled="!tooltip">
		<p class="text-xs text-dimmed mt-2 truncate">
			{{ parts.join(' · ') }}
		</p>
	</UTooltip>
</template>
