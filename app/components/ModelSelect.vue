<script setup lang="ts">
import type { SelectMenuItem } from '@nuxt/ui'

/** The chosen model id; unset means the platform's default. */
const model = defineModel<string | undefined>()

const { models, resolveModel } = useModels()
const current = computed(() => resolveModel(model.value))

// One group per vendor, each model with its price, context length and inputs.
const items = computed<SelectMenuItem[][]>(() => {
	const groups: Record<string, SelectMenuItem[]> = {}
	for (const entry of models.value) {
		const details = [
			entry.pricing && `${formatUsd(entry.pricing.input)} / ${formatUsd(entry.pricing.output)} per 1M`,
			entry.contextLength && `${formatTokens(entry.contextLength)} context`,
			entry.inputModalities.filter(modality => modality !== 'text').join(', '),
		].filter(Boolean)
		;(groups[entry.vendor] ??= [{ type: 'label', label: entry.vendor }]).push({
			label: entry.name,
			value: entry.id,
			description: details.join(' · '),
		})
	}
	return Object.values(groups)
})
</script>

<template>
	<USelectMenu
		:model-value="current?.id"
		:items="items"
		value-key="value"
		:filter-fields="['label', 'value']"
		:search-input="{ placeholder: 'Search models...' }"
		placeholder="Select a model"
		size="sm"
		color="neutral"
		variant="ghost"
		class="data-[state=open]:bg-elevated max-w-56"
		:content="{ align: 'end' }"
		:ui="{
			content: 'min-w-80',
			trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200',
		}"
		@update:model-value="model = $event as string"
	/>
</template>
