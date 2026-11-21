<script setup lang="ts">
import { LazyModelBrowser } from '#components'
import type { BrowsableModel } from '~/composables/useModels'

const props = withDefaults(defineProps<{
	models: BrowsableModel[]
	placeholder?: string
	/** Offers to clear the choice, which means `null`. */
	clearable?: boolean
}>(), { placeholder: 'Choose a model' })

const model = defineModel<string | null>({ default: null })

const browser = useOverlay().create(LazyModelBrowser)
const current = computed(() => props.models.find(entry => entry.id === model.value))

async function choose() {
	const id = await browser.open({ models: props.models, selected: model.value }).result
	if (id) model.value = id
}
</script>

<template>
	<UFieldGroup class="w-full">
		<UButton
			color="neutral"
			variant="outline"
			trailing-icon="i-lucide-chevrons-up-down"
			class="flex-1 min-w-0"
			:ui="{ trailingIcon: 'ms-auto text-dimmed' }"
			@click="choose"
		>
			<span v-if="model" class="flex items-baseline gap-2 min-w-0">
				<span class="truncate">{{ current?.name ?? model }}</span>
				<span v-if="current" class="text-xs text-muted font-mono truncate">{{ model }}</span>
			</span>
			<span v-else class="text-dimmed truncate">{{ placeholder }}</span>
		</UButton>
		<UButton
			v-if="clearable && model"
			icon="i-lucide-x"
			color="neutral"
			variant="outline"
			aria-label="Clear"
			@click="model = null"
		/>
	</UFieldGroup>
</template>
