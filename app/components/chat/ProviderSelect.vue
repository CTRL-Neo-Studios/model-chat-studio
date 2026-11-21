<script setup lang="ts">
const props = defineProps<{
	modelId: string
	/** Renders as a full-width form control instead of the prompt's compact button. */
	field?: boolean
}>()

/** Endpoint tags in the order they were picked; empty or unset means automatic routing. */
const providers = defineModel<string[] | undefined>('providers')
/** Whether OpenRouter may use other providers when the chosen ones fail. Defaults to true. */
const allowFallbacks = defineModel<boolean | undefined>('allowFallbacks')

const open = ref(false)

// Loaded when the picker first opens (or at once, to name chosen providers), and again after the model changes.
const { data: endpoints, status, execute, clear } = useFetch('/api/v1/models/endpoints', {
	query: computed(() => ({ id: props.modelId })),
	immediate: !!providers.value?.length,
	server: false,
	watch: false,
})
const loading = computed(() => status.value === 'pending')

watch(() => props.modelId, () => clear())
watch(open, (value) => {
	if (value && !endpoints.value) execute()
})

const chosen = computed(() => providers.value ?? [])

const label = computed(() => {
	const [first, ...rest] = chosen.value
	if (!first) return 'Auto'
	const name = endpoints.value?.find(endpoint => endpoint.tag === first)?.name ?? first
	return rest.length ? `${name} +${rest.length}` : name
})

function toggle(tag: string) {
	const next = chosen.value.includes(tag) ? chosen.value.filter(t => t !== tag) : [...chosen.value, tag]
	providers.value = next.length ? next : undefined
}

function percent(value: number | null) {
	return value === null ? null : `${Math.round(value * 10) / 10}%`
}
</script>

<template>
	<UPopover v-model:open="open" :content="{ side: field ? 'bottom' : 'top', align: field ? 'start' : 'end' }">
		<UButton
			v-if="field"
			icon="i-lucide-server"
			:label="chosen.length ? label : 'Automatic routing'"
			color="neutral"
			variant="outline"
			trailing-icon="i-lucide-chevron-down"
			class="w-full"
			:ui="{ label: 'truncate', trailingIcon: 'ms-auto text-dimmed' }"
			aria-label="Choose providers"
		/>
		<UButton
			v-else
			icon="i-lucide-server"
			:label="label"
			size="sm"
			color="neutral"
			variant="ghost"
			class="data-[state=open]:bg-elevated max-w-40"
			:ui="{ label: 'truncate' }"
			aria-label="Choose providers"
		/>

		<template #content>
			<div class="w-96 max-w-[calc(100vw-2rem)] p-3 flex flex-col gap-3">
				<div class="flex items-start justify-between gap-2">
					<div>
						<p class="text-sm font-medium text-highlighted">
							Providers
						</p>
						<p class="text-xs text-muted">
							{{ chosen.length ? 'Tried in the order picked.' : 'Automatic: OpenRouter picks a provider.' }}
						</p>
					</div>
					<UButton v-if="chosen.length" label="Auto" size="xs" color="neutral" variant="soft" @click="providers = undefined" />
				</div>

				<USwitch
					v-if="chosen.length"
					:model-value="allowFallbacks ?? true"
					label="Fall back to other providers"
					description="When the chosen ones are down or busy."
					size="sm"
					@update:model-value="allowFallbacks = $event"
				/>

				<div v-if="loading" class="flex justify-center py-6">
					<UIcon name="i-lucide-loader-circle" class="size-5 animate-spin text-muted" />
				</div>
				<p v-else-if="!endpoints?.length" class="text-sm text-muted py-2">
					No provider information for this model.
				</p>
				<div v-else class="flex flex-col gap-0.5 max-h-72 overflow-y-auto -mx-1">
					<button
						v-for="endpoint in endpoints"
						:key="endpoint.tag"
						type="button"
						:data-selected="chosen.includes(endpoint.tag)"
						class="flex items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-elevated/50 data-[selected=true]:bg-elevated/50"
						@click="toggle(endpoint.tag)"
					>
						<UBadge
							v-if="chosen.includes(endpoint.tag)"
							:label="String(chosen.indexOf(endpoint.tag) + 1)"
							size="sm"
							class="w-5 justify-center"
						/>
						<span v-else class="w-5 shrink-0" />

						<div class="flex-1 min-w-0">
							<p class="text-sm text-highlighted truncate">
								{{ endpoint.name }}
								<span class="text-xs text-dimmed">{{ endpoint.tag }}</span>
							</p>
							<p class="text-xs text-muted truncate">
								<template v-if="endpoint.pricing">
									{{ formatUsd(endpoint.pricing.input) }} / {{ formatUsd(endpoint.pricing.output) }} per 1M
								</template>
								<template v-if="endpoint.quantization">
									· {{ endpoint.quantization }}
								</template>
								<template v-if="percent(endpoint.uptime1d)">
									· {{ percent(endpoint.uptime1d) }} up (1d)
								</template>
							</p>
						</div>

						<UTooltip v-if="endpoint.status < 0" text="Degraded right now">
							<UIcon name="i-lucide-triangle-alert" class="size-4 text-warning shrink-0" />
						</UTooltip>
					</button>
				</div>
			</div>
		</template>
	</UPopover>
</template>
