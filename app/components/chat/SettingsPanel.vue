<script setup lang="ts">
import type { ModelParams } from '#shared/utils/chat'
import type { CatalogModelView } from '~/composables/useModels'

const props = defineProps<{
	model?: CatalogModelView
	/** The chat's web search switch: DeepSeek ignores sampling while it is on. */
	webSearch?: boolean
}>()

const params = defineModel<ModelParams>('params', { required: true })
const systemPrompt = defineModel<string>('systemPrompt', { required: true })

const { platform } = useModels()
const supports = (parameter: string) => !!props.model?.supportedParameters.includes(parameter)

// DeepSeek ignores temperature and top-p while thinking, web search or the safety check is on.
const samplingIgnored = computed(() => {
	if (platform.value?.id !== 'deepseek') return undefined
	const reasoning = props.model?.reasoning
	const level = params.value.reasoningLevel
	if (reasoning && (level ? level !== 'none' : reasoning.defaultEnabled)) return 'DeepSeek ignores these while reasoning is on.'
	if (props.webSearch && props.model?.webSearch) return 'DeepSeek ignores these while web search is on.'
	if (platform.value.safetyCheck) return 'DeepSeek ignores these while the safety check is on.'
	return undefined
})

const sliders = computed(() => [
	{ key: 'temperature' as const, parameter: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.05, hint: 'Higher is more varied, lower is more focused.' },
	{ key: 'topP' as const, parameter: 'top_p', label: 'Top-p', min: 0.05, max: 1, step: 0.05, hint: 'Samples from the most likely tokens that add up to this share.' },
].filter(slider => supports(slider.parameter)))

const customized = computed(() => !!systemPrompt.value || params.value.temperature !== undefined || params.value.topP !== undefined || params.value.maxOutputTokens !== undefined)
</script>

<template>
	<UPopover :content="{ side: 'top', align: 'end' }">
		<UChip :show="customized" size="sm" inset>
			<UButton
				icon="i-lucide-sliders-horizontal"
				size="sm"
				color="neutral"
				variant="ghost"
				class="data-[state=open]:bg-elevated"
				aria-label="Chat settings"
			/>
		</UChip>

		<template #content>
			<div class="w-80 max-w-[calc(100vw-2rem)] max-h-(--reka-popover-content-available-height) overflow-y-auto p-3 flex flex-col gap-4">
				<UFormField label="System prompt" description="Added to the instructions of every answer in this chat.">
					<UTextarea
						v-model="systemPrompt"
						autoresize
						:rows="3"
						:maxrows="10"
						:maxlength="20000"
						placeholder="You are a concise assistant who answers in French."
						class="w-full"
					/>
				</UFormField>

				<UAlert v-if="samplingIgnored && sliders.length" :title="samplingIgnored" icon="i-lucide-info" color="neutral" variant="subtle" />

				<UFormField
					v-for="slider in sliders"
					:key="slider.key"
					:label="slider.label"
					:description="slider.hint"
				>
					<template #hint>
						<span class="tabular-nums">{{ params[slider.key] ?? 'Default' }}</span>
						<UButton
							v-if="params[slider.key] !== undefined"
							icon="i-lucide-rotate-ccw"
							size="xs"
							color="neutral"
							variant="link"
							aria-label="Reset to default"
							@click="params[slider.key] = undefined"
						/>
					</template>
					<USlider
						:model-value="params[slider.key] ?? 1"
						:min="slider.min"
						:max="slider.max"
						:step="slider.step"
						:disabled="!!samplingIgnored"
						size="sm"
						@update:model-value="params[slider.key] = $event as number"
					/>
				</UFormField>

				<UFormField v-if="supports('max_tokens')" label="Max output tokens" :description="model?.maxOutputTokens ? `Up to ${formatTokens(model.maxOutputTokens)}.` : undefined">
					<UInputNumber
						:model-value="params.maxOutputTokens ?? null"
						:min="1"
						:max="model?.maxOutputTokens ?? undefined"
						:step="256"
						placeholder="Default"
						class="w-full"
						@update:model-value="params.maxOutputTokens = $event ?? undefined"
					/>
				</UFormField>
			</div>
		</template>
	</UPopover>
</template>
