<script setup lang="ts">
import { LazyModelBrowser } from '#components'
import type { BrowsableModel } from '~/composables/useModels'

const props = withDefaults(defineProps<{
	models: BrowsableModel[]
	placeholder?: string
	/** Offers to clear the choice, which means `null`. */
	clearable?: boolean
	/** The list's request, shown in the browser while it is open. */
	status?: 'pending' | 'error' | 'success'
	error?: string
	/** Why no model can be chosen; disables the field and shows instead of the placeholder. */
	disabledReason?: string
}>(), { placeholder: 'Choose a model', status: 'success', error: undefined, disabledReason: undefined })

const emit = defineEmits<{ retry: [] }>()

const model = defineModel<string | null>({ default: null })

const browser = useOverlay().create(LazyModelBrowser)
const current = computed(() => props.models.find(entry => entry.id === model.value))

// The list may still be loading when the browser opens; it follows the list until closed.
const list = computed(() => ({ models: props.models, status: props.status, error: props.error }))
let open = false
watch(list, (value) => {
	if (open) browser.patch(value)
})

async function choose() {
	open = true
	const id = await browser.open({ ...list.value, selected: model.value, onRetry: () => emit('retry') }).result
	open = false
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
			:disabled="!!disabledReason"
			:ui="{ trailingIcon: 'ms-auto text-dimmed' }"
			@click="choose"
		>
			<span v-if="model" class="flex items-baseline gap-2 min-w-0">
				<span class="truncate">{{ current?.name ?? model }}</span>
				<span v-if="current" class="text-xs text-muted font-mono truncate">{{ model }}</span>
			</span>
			<span v-else class="text-dimmed truncate">{{ disabledReason ?? placeholder }}</span>
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
