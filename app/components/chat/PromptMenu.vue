<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { CatalogModelView } from '~/composables/useModels'

const props = defineProps<{
	/** The model in use; its catalog entry decides which controls apply. */
	model?: CatalogModelView
	/** Opens the file picker of the prompt. */
	open: () => void
}>()

defineShortcuts({
	meta_u: { usingInput: true, handler: () => props.open() },
})

const webSearch = defineModel<boolean | undefined>('webSearch')
/** `none` is off, `on` is on at the model's default effort, unset is the model's default. */
const reasoningLevel = defineModel<string | undefined>('reasoningLevel')

const levelLabels: Record<string, string> = { none: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }

const reasoningItem = computed<DropdownMenuItem | undefined>(() => {
	const reasoning = props.model?.reasoning
	if (!reasoning) return undefined
	const levels = props.model!.reasoningLevels

	// Toggle-only models: on or off.
	if (!levels.length) {
		return {
			label: 'Reasoning',
			icon: 'i-lucide-brain',
			type: 'checkbox',
			disabled: reasoning.mandatory,
			checked: reasoningLevel.value ? reasoningLevel.value !== 'none' : reasoning.defaultEnabled,
			onUpdateChecked: (checked: boolean) => {
				reasoningLevel.value = checked ? 'on' : 'none'
			},
			onSelect: (e: Event) => e.preventDefault(),
		}
	}

	const choices = reasoning.mandatory || levels.includes('none') ? levels : ['none', ...levels]
	const fallback = props.model!.defaultReasoningLevel
	return {
		label: 'Reasoning',
		icon: 'i-lucide-brain',
		children: [
			{
				label: fallback ? `Default (${levelLabels[fallback] ?? fallback})` : 'Default',
				type: 'checkbox',
				checked: !reasoningLevel.value || !choices.includes(reasoningLevel.value),
				onSelect: () => {
					reasoningLevel.value = undefined
				},
			},
			...choices.map(level => ({
				label: levelLabels[level] ?? level,
				type: 'checkbox' as const,
				checked: reasoningLevel.value === level,
				onSelect: () => {
					reasoningLevel.value = level
				},
			})),
		],
	}
})

const items = computed<DropdownMenuItem[][]>(() => [[{
	label: 'Add files or photos',
	icon: 'i-lucide-paperclip',
	kbds: ['meta', 'U'],
	onSelect: () => props.open(),
}], [
	...(props.model?.webSearch
		? [{
				label: 'Web search',
				icon: 'i-lucide-globe',
				type: 'checkbox' as const,
				checked: !!webSearch.value,
				onUpdateChecked: (checked: boolean) => {
					webSearch.value = checked
				},
				onSelect: (e: Event) => e.preventDefault(),
			}]
		: []),
	...(reasoningItem.value ? [reasoningItem.value] : []),
]].filter(group => group.length))
</script>

<template>
	<UDropdownMenu
		:items="items"
		:content="{ side: 'top', align: 'start', alignOffset: -4 }"
		:ui="{ content: 'w-52' }"
		size="sm"
	>
		<UButton
			icon="i-lucide-plus"
			color="neutral"
			variant="ghost"
			size="sm"
			aria-label="Open prompt menu"
			class="data-[state=open]:bg-elevated"
		/>
	</UDropdownMenu>
</template>
