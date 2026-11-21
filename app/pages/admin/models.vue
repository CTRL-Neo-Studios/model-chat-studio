<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ minRole: 'admin' })
useHead({ title: 'Models' })

const act = useApiAction()
const queryCache = useQueryCache()
const { data, error, isPending, refetch: refresh } = useQuery(adminCatalogQuery({}))
type Row = NonNullable<typeof data.value>['models'][number]

const platform = computed(() => data.value?.platform ?? null)
const models = computed(() => data.value?.models ?? [])
const allowedCount = computed(() => models.value.filter(model => model.enabled).length)

const search = ref('')
const allowedOnly = ref(false)
const LIMIT = 100
const matches = computed(() => {
	const term = search.value.trim().toLowerCase()
	return models.value.filter(model => (!allowedOnly.value || model.enabled)
		&& (!term || model.id.toLowerCase().includes(term) || model.name.toLowerCase().includes(term)))
})

async function setAllowed(row: Row, enabled: boolean) {
	await act('/api/v1/admin/models', { method: 'PATCH', body: { platform: platform.value, modelId: row.id, enabled } })
	// Members' model picker follows the allowlist.
	await Promise.all([refresh(), queryCache.invalidateQueries({ key: modelsQuery.key, exact: true })])
}

// Price override (DeepSeek only: OpenRouter reports the cost of every answer).
const priceTarget = ref<Row | null>(null)
const price = reactive({ input: null as number | null, cacheRead: null as number | null, output: null as number | null })
function openPrice(row: Row) {
	Object.assign(price, row.priceOverride)
	priceTarget.value = row
}
async function savePrice() {
	const row = priceTarget.value!
	priceTarget.value = null
	const saved = await act('/api/v1/admin/models', {
		method: 'PATCH',
		body: { platform: platform.value, modelId: row.id, priceInput: price.input, priceCachedInput: price.cacheRead, priceOutput: price.output },
		success: 'Price saved',
	})
	if (saved) await refresh()
}

const columns = computed<TableColumn<Row>[]>(() => [
	{ id: 'allowed', header: 'Allowed' },
	{ id: 'model', header: 'Model' },
	{ id: 'price', header: 'Input / output per 1M' },
	{ accessorKey: 'contextLength', header: 'Context', cell: ({ row }) => row.original.contextLength ? formatTokens(row.original.contextLength) : '' },
	...(platform.value === 'deepseek' ? [{ id: 'actions' }] : []),
])
</script>

<template>
	<AdminPanel title="Models">
		<USkeleton v-if="isPending" class="h-14 w-full" />
		<UAlert v-else-if="error" color="error" variant="subtle" icon="i-lucide-alert-circle" title="The models could not be loaded" :description="serverMessage(error)" :actions="[{ label: 'Retry', color: 'error', variant: 'outline', onClick: () => refresh() }]" />
		<UAlert v-else-if="!platform" color="warning" variant="subtle" icon="i-lucide-plug-zap" title="No platform is active" description="Choose a platform and add its key in the settings first." />
		<UAlert v-else-if="!data?.hasKey" color="warning" variant="subtle" icon="i-lucide-key-round" title="The active platform has no key" description="Add its key in the settings to list its models." />

		<template v-else>
			<UAlert
				:color="allowedCount ? 'neutral' : 'info'"
				variant="subtle"
				icon="i-lucide-list-checks"
				:title="allowedCount ? `Members can use ${allowedCount} of ${models.length} models` : `Members can use all ${models.length} models`"
				:description="allowedCount ? 'Only allowed models appear in the model picker. Remove every model from the list to allow all of them again.' : 'Allow models to limit the picker to them. Until one is allowed, every model is available.'"
			/>

			<div class="flex flex-wrap items-center gap-3">
				<UInput v-model="search" icon="i-lucide-search" placeholder="Search by name or id" class="w-72" />
				<USwitch v-model="allowedOnly" label="Allowed only" />
				<span class="text-sm text-muted ms-auto">{{ matches.length > LIMIT ? `First ${LIMIT} of ${matches.length}; search to narrow` : `${matches.length} models` }}</span>
			</div>

			<UTable :data="matches.slice(0, LIMIT)" :columns="columns">
				<template #allowed-cell="{ row }">
					<USwitch :model-value="row.original.enabled" :aria-label="`Allow ${row.original.name}`" @update:model-value="setAllowed(row.original, $event)" />
				</template>
				<template #model-cell="{ row }">
					<p class="text-highlighted">
						{{ row.original.name }}
					</p>
					<p class="text-xs text-muted">
						{{ row.original.id }}
					</p>
				</template>
				<template #price-cell="{ row }">
					<template v-if="row.original.priceOverride.input !== null && row.original.priceOverride.output !== null">
						{{ formatUsd(row.original.priceOverride.input) }} / {{ formatUsd(row.original.priceOverride.output) }}
						<UBadge label="Override" size="sm" variant="subtle" class="ms-1" />
					</template>
					<template v-else-if="row.original.pricing">
						{{ formatUsd(row.original.pricing.input) }} / {{ formatUsd(row.original.pricing.output) }}
					</template>
					<span v-else class="text-muted">Unknown</span>
				</template>
				<template #actions-cell="{ row }">
					<div class="flex justify-end">
						<UButton label="Price…" color="neutral" variant="ghost" size="sm" @click="openPrice(row.original)" />
					</div>
				</template>
			</UTable>
		</template>

		<UModal :open="!!priceTarget" :title="`Price for ${priceTarget?.name}`" description="USD per 1M tokens, used to work out the cost of each answer. The built-in DeepSeek prices switch between peak and off-peak; an override applies at all hours. Leave input or output empty to use the built-in price." @update:open="!$event && (priceTarget = null)">
			<template #body>
				<div class="grid grid-cols-3 gap-3">
					<UFormField label="Input">
						<UInputNumber v-model="price.input" :min="0" :step="0.01" placeholder="Built-in" />
					</UFormField>
					<UFormField label="Cached input">
						<UInputNumber v-model="price.cacheRead" :min="0" :step="0.001" placeholder="= input" />
					</UFormField>
					<UFormField label="Output">
						<UInputNumber v-model="price.output" :min="0" :step="0.01" placeholder="Built-in" />
					</UFormField>
				</div>
			</template>
			<template #footer>
				<div class="flex gap-2 justify-end w-full">
					<UButton label="Cancel" color="neutral" variant="ghost" @click="priceTarget = null" />
					<UButton label="Save" @click="savePrice" />
				</div>
			</template>
		</UModal>
	</AdminPanel>
</template>
