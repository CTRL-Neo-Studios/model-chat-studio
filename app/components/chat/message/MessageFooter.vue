<script setup lang="ts">
import type { MessageMetadata } from '#shared/utils/chat'

const props = defineProps<{
	metadata: MessageMetadata
}>()

const { models } = useModels()

// Model, provider, tokens, cost and time, as far as the platform reported them.
const parts = computed(() => {
	const { model, provider, inputTokens, outputTokens, reasoningTokens, costUsd, durationMs, edited } = props.metadata
	return [
		models.value.find(entry => entry.id === model)?.name ?? model,
		provider,
		inputTokens !== undefined && outputTokens !== undefined && `${formatTokens(inputTokens)} in · ${formatTokens(outputTokens)} out`,
		reasoningTokens ? `${formatTokens(reasoningTokens)} reasoning` : undefined,
		typeof costUsd === 'number' ? formatUsd(costUsd) : undefined,
		durationMs !== undefined ? `${(durationMs / 1000).toFixed(1)} s` : undefined,
		edited ? 'edited' : undefined,
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
	<!-- What auto-fetch added from the project for this answer. -->
	<p v-if="metadata.fetched?.length" class="text-xs text-dimmed mt-1 flex items-center gap-1 min-w-0">
		<UIcon name="i-lucide-folder-search" class="size-3.5 shrink-0" />
		<span class="truncate" :title="metadata.fetched.map(entry => entry.name).join('\n')">Fetched: {{ metadata.fetched.map(entry => entry.name).join(', ') }}</span>
	</p>
</template>
