<script setup lang="ts">
import { LANE_COLORS, type LaneFields, type ModelParams } from '#shared/utils/chat'
import { DEFAULT_INSTRUCTIONS, estimateTokens } from '#shared/utils/instructions'
import type { CatalogModelView } from '~/composables/useModels'

/** A model with its settings, as profiles and lanes store it. */
const draft = defineModel<Omit<LaneFields, 'enabled'>>({ required: true })

const props = defineProps<{
	models: CatalogModelView[]
	/** Placeholder for an unnamed draft, e.g. the model's name. */
	namePlaceholder?: string
}>()

const { platform } = useModels()
const model = computed(() => props.models.find(entry => entry.id === draft.value.modelId))
const supports = (parameter: string) => !!model.value?.supportedParameters.includes(parameter)
const params = computed(() => draft.value.params)

// Provider and reasoning choices belong to one model.
function chooseModel(id: string | null) {
	if (id === draft.value.modelId) return
	draft.value = { ...draft.value, modelId: id, params: { ...draft.value.params, providers: undefined, reasoningLevel: undefined } }
}

const colorItems = [
	{ label: 'No color', value: null, swatch: 'border border-dashed border-accented' },
	...LANE_COLORS.map(color => ({ label: color.charAt(0).toUpperCase() + color.slice(1), value: color, swatch: LANE_COLOR_CLASSES[color] })),
]

const promptMode = computed({
	get: () => draft.value.systemPrompt === null ? 'default' : 'custom',
	set: (mode) => { draft.value.systemPrompt = mode === 'default' ? null : (draft.value.systemPrompt ?? '') },
})
const promptTokens = computed(() => estimateTokens(draft.value.systemPrompt ?? DEFAULT_INSTRUCTIONS))

const levelLabels: Record<string, string> = { none: 'Off', on: 'On', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }
const reasoningItems = computed(() => {
	const reasoning = model.value?.reasoning
	if (!reasoning) return []
	const levels = model.value!.reasoningLevels.length ? model.value!.reasoningLevels.filter(level => level !== 'none') : ['on']
	return [
		{ label: 'Default', value: 'default' },
		...(reasoning.mandatory ? [] : [{ label: 'Off', value: 'none' }]),
		...levels.map(level => ({ label: levelLabels[level] ?? level, value: level })),
	]
})
const reasoningLevel = computed({
	get: () => params.value.reasoningLevel ?? 'default',
	set: (value) => { draft.value.params.reasoningLevel = value === 'default' ? undefined : value },
})

const sortItems = [
	{ label: 'Default order', value: 'default' },
	{ label: 'Lowest price', value: 'price' },
	{ label: 'Highest throughput', value: 'throughput' },
	{ label: 'Lowest latency', value: 'latency' },
]
const providerSort = computed({
	get: () => params.value.providerSort ?? 'default',
	set: (value) => { draft.value.params.providerSort = value === 'default' ? undefined : value as ModelParams['providerSort'] },
})

type SliderKey = 'temperature' | 'topP' | 'topK' | 'minP' | 'topA' | 'frequencyPenalty' | 'presencePenalty' | 'repetitionPenalty'
// `neutral` is where the slider rests while the setting is left to the model.
const sliders = computed(() => ([
	{ key: 'temperature', parameter: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.05, neutral: 1 },
	{ key: 'topP', parameter: 'top_p', label: 'Top P', min: 0.01, max: 1, step: 0.01, neutral: 1 },
	{ key: 'topK', parameter: 'top_k', label: 'Top K', min: 0, max: 200, step: 1, neutral: 0 },
	{ key: 'minP', parameter: 'min_p', label: 'Min P', min: 0, max: 1, step: 0.01, neutral: 0 },
	{ key: 'topA', parameter: 'top_a', label: 'Top A', min: 0, max: 1, step: 0.01, neutral: 0 },
	{ key: 'frequencyPenalty', parameter: 'frequency_penalty', label: 'Frequency penalty', min: -2, max: 2, step: 0.05, neutral: 0 },
	{ key: 'presencePenalty', parameter: 'presence_penalty', label: 'Presence penalty', min: -2, max: 2, step: 0.05, neutral: 0 },
	{ key: 'repetitionPenalty', parameter: 'repetition_penalty', label: 'Repetition penalty', min: 0.01, max: 2, step: 0.01, neutral: 1 },
] satisfies { key: SliderKey, parameter: string, label: string, min: number, max: number, step: number, neutral: number }[]).filter(slider => supports(slider.parameter)))
const customized = computed(() => sliders.value.filter(slider => params.value[slider.key] !== undefined).length + (params.value.maxOutputTokens === undefined ? 0 : 1))
</script>

<template>
	<div class="flex flex-col gap-5">
		<div class="flex items-center gap-2">
			<UPopover :content="{ align: 'start' }">
				<UButton color="neutral" variant="outline" square aria-label="Color label" class="size-9 justify-center">
					<span :class="['size-4 rounded-full', draft.color ? LANE_COLOR_CLASSES[draft.color] : 'border border-dashed border-accented']" />
				</UButton>
				<template #content>
					<div class="grid grid-cols-6 gap-1.5 p-2">
						<UTooltip v-for="item in colorItems" :key="item.label" :text="item.label">
							<UButton
								color="neutral"
								:variant="draft.color === item.value ? 'soft' : 'ghost'"
								square
								:aria-label="item.label"
								class="size-8 justify-center"
								@click="draft.color = item.value"
							>
								<span :class="['size-4 rounded-full', item.swatch]" />
							</UButton>
						</UTooltip>
					</div>
				</template>
			</UPopover>
			<UInput :model-value="draft.name ?? ''" :placeholder="namePlaceholder ?? 'Name'" :maxlength="60" class="flex-1" @update:model-value="draft.name = String($event)" />
		</div>

		<UFormField label="Model">
			<ModelField :model-value="draft.modelId" :models="models" @update:model-value="chooseModel" />
		</UFormField>

		<div v-if="reasoningItems.length || (model && platform?.capabilities.providerRouting)" class="grid sm:grid-cols-2 gap-x-4 gap-y-5">
			<UFormField v-if="reasoningItems.length" label="Reasoning">
				<USelect v-model="reasoningLevel" :items="reasoningItems" class="w-full" />
			</UFormField>
			<template v-if="model && platform?.capabilities.providerRouting">
				<UFormField label="Providers">
					<ChatProviderSelect v-model:providers="draft.params.providers" v-model:allow-fallbacks="draft.params.allowFallbacks" :model-id="model.id" field />
				</UFormField>
				<UFormField label="Provider ranking">
					<USelect v-model="providerSort" :items="sortItems" class="w-full" />
				</UFormField>
				<USwitch
					:model-value="!!draft.params.zdr"
					label="Zero data retention"
					description="Only providers that do not keep prompts."
					class="sm:pt-6"
					@update:model-value="draft.params.zdr = $event || undefined"
				/>
			</template>
		</div>

		<UFormField label="System prompt" :help="`About ${promptTokens.toLocaleString('en-US')} tokens`">
			<template #hint>
				<UTabs
					v-model="promptMode"
					:items="[{ label: 'Default', value: 'default' }, { label: 'Custom', value: 'custom' }]"
					:content="false"
					color="neutral"
					size="xs"
				/>
			</template>
			<UTextarea
				v-if="draft.systemPrompt === null"
				:model-value="DEFAULT_INSTRUCTIONS"
				readonly
				autoresize
				:maxrows="8"
				variant="soft"
				class="w-full"
				:ui="{ base: 'text-muted' }"
			/>
			<UTextarea
				v-else
				v-model="draft.systemPrompt"
				autoresize
				:rows="4"
				:maxrows="12"
				:maxlength="20000"
				placeholder="e.g. You are a world-class pirate captain."
				class="w-full"
			/>
		</UFormField>

		<UCollapsible v-if="model" class="rounded-md border border-default">
			<UButton
				color="neutral"
				variant="ghost"
				block
				trailing-icon="i-lucide-chevron-down"
				:label="customized ? `Sampling parameters (${customized} set)` : 'Sampling parameters'"
				class="justify-between group"
				:ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
			/>
			<template #content>
				<div class="flex flex-col gap-4 p-3 pt-1">
					<p v-if="platform?.capabilities.providerRouting" class="text-sm text-muted">
						The model lists these settings, but a provider serving it may ignore some.
					</p>
					<p v-if="platform?.id === 'deepseek'" class="text-sm text-muted">
						DeepSeek ignores temperature and top-p while reasoning, web search or the safety check is on.
					</p>
					<p v-if="!sliders.length && !supports('max_tokens')" class="text-sm text-muted">
						This model takes no sampling parameters.
					</p>
					<UFormField v-for="slider in sliders" :key="slider.key" :label="slider.label">
						<template #hint>
							<span class="tabular-nums">{{ params[slider.key] ?? 'Default' }}</span>
							<UButton
								v-if="params[slider.key] !== undefined"
								icon="i-lucide-rotate-ccw"
								size="xs"
								color="neutral"
								variant="link"
								aria-label="Reset to default"
								@click="draft.params[slider.key] = undefined"
							/>
						</template>
						<USlider
							:model-value="params[slider.key] ?? slider.neutral"
							:min="slider.min"
							:max="slider.max"
							:step="slider.step"
							size="sm"
							@update:model-value="draft.params[slider.key] = $event as number"
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
							@update:model-value="draft.params.maxOutputTokens = $event ?? undefined"
						/>
					</UFormField>
				</div>
			</template>
		</UCollapsible>
	</div>
</template>
