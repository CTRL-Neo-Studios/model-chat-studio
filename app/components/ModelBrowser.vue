<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn, TableRow } from '@nuxt/ui'
import type { BrowsableModel } from '~/composables/useModels'

type Entry = BrowsableModel

const props = withDefaults(defineProps<{
	models: Entry[]
	selected?: string | null
	title?: string
	/** The list's request; `pending` with no models shows placeholder rows. */
	status?: 'pending' | 'error' | 'success'
	error?: string
}>(), { selected: null, title: 'Choose a model', status: 'success', error: undefined })

/** The chosen model id, or nothing when dismissed. */
const emit = defineEmits<{ close: [id?: string], retry: [] }>()

// Speech-to-text models: priced per minute of audio, and the input filter does not apply.
const perMinute = computed(() => props.models.some(entry => entry.pricePerMinute !== undefined))

const UIcon = resolveComponent('UIcon')
const UTooltip = resolveComponent('UTooltip')

const search = ref('')
const input = ref<'any' | 'image' | 'file'>('any')
const sort = ref<'name' | 'price' | 'context'>('name')

const inputFilters = [
	{ label: 'Any input', value: 'any' },
	{ label: 'Reads images', value: 'image' },
	{ label: 'Reads PDFs', value: 'file' },
]
const sorts = computed(() => [
	{ label: 'By name', value: 'name' },
	{ label: 'Cheapest first', value: 'price' },
	...(perMinute.value ? [] : [{ label: 'Largest context', value: 'context' }]),
])

// Every word must appear in the name, id or vendor.
const rows = computed(() => {
	const words = search.value.toLowerCase().split(/\s+/).filter(Boolean)
	const price = (entry: Entry) => entry.pricePerMinute ?? (entry.pricing ? entry.pricing.input + entry.pricing.output : null) ?? Number.POSITIVE_INFINITY
	return props.models
		.filter(entry => input.value === 'any' || entry.inputModalities.includes(input.value))
		.filter((entry) => {
			const text = `${entry.name} ${entry.id} ${entry.vendor}`.toLowerCase()
			return words.every(word => text.includes(word))
		})
		.toSorted((a, b) => sort.value === 'price'
			? price(a) - price(b)
			: sort.value === 'context'
				? (b.contextLength ?? 0) - (a.contextLength ?? 0)
				: a.name.localeCompare(b.name))
})

const modalityIcons: Record<string, { icon: string, label: string }> = {
	text: { icon: 'i-lucide-type', label: 'Text' },
	image: { icon: 'i-lucide-image', label: 'Images' },
	file: { icon: 'i-lucide-file-text', label: 'PDFs' },
	audio: { icon: 'i-lucide-audio-lines', label: 'Audio' },
}
const modalities = (list: string[]) => h('div', { class: 'flex gap-1 text-muted' }, list.filter(m => modalityIcons[m]).map(m =>
	h(UTooltip, { text: modalityIcons[m]!.label }, () => h(UIcon, { name: modalityIcons[m]!.icon, class: 'size-4' })),
))

const columns = computed<TableColumn<Entry>[]>(() => [{
	accessorKey: 'name',
	header: 'Model',
	cell: ({ row }) => h('div', { class: 'flex flex-col min-w-0' }, [
		h('span', { class: 'font-medium text-highlighted truncate' }, row.original.name),
		h('span', { class: 'text-xs text-muted font-mono truncate' }, row.original.id),
	]),
	meta: { class: { td: 'max-w-72' } },
}, {
	id: 'input',
	header: 'Input',
	cell: ({ row }) => modalities(row.original.inputModalities),
}, {
	id: 'output',
	header: 'Output',
	cell: ({ row }) => modalities(row.original.outputModalities),
}, ...(perMinute.value
	? [{
			id: 'price',
			header: 'Price per minute',
			cell: ({ row }) => row.original.pricePerMinute != null ? formatUsd(row.original.pricePerMinute) : 'Unknown',
			meta: { class: { th: 'text-right', td: 'text-right tabular-nums' } },
		} satisfies TableColumn<Entry>]
	: [{
			accessorKey: 'contextLength',
			header: 'Context',
			cell: ({ row }) => row.original.contextLength ? formatTokens(row.original.contextLength) : '–',
			meta: { class: { th: 'text-right', td: 'text-right tabular-nums' } },
		}, {
			accessorKey: 'maxOutputTokens',
			header: 'Max output',
			cell: ({ row }) => row.original.maxOutputTokens ? formatTokens(row.original.maxOutputTokens) : '–',
			meta: { class: { th: 'text-right', td: 'text-right tabular-nums' } },
		}, {
			id: 'price',
			header: 'Price per 1M (in / out)',
			cell: ({ row }) => row.original.pricing ? `${formatUsd(row.original.pricing.input)} / ${formatUsd(row.original.pricing.output)}` : 'Unknown',
			meta: { class: { th: 'text-right', td: 'text-right tabular-nums' } },
		}] satisfies TableColumn<Entry>[])])

function choose(_event: Event, row: TableRow<Entry>) {
	emit('close', row.original.id)
}
</script>

<template>
	<UModal :title="title" :ui="{ content: 'sm:max-w-5xl', body: 'flex flex-col gap-3' }" @update:open="emit('close')">
		<template #body>
			<div class="flex flex-wrap items-center gap-2">
				<UInput v-model="search" icon="i-lucide-search" placeholder="Search models..." autofocus class="flex-1 min-w-48">
					<template #trailing>
						<span class="text-xs text-muted tabular-nums">{{ rows.length }} models</span>
					</template>
				</UInput>
				<USelect v-if="!perMinute" v-model="input" :items="inputFilters" class="w-40" />
				<USelect v-model="sort" :items="sorts" class="w-40" />
			</div>
			<UAlert
				v-if="status === 'error' && !models.length"
				color="error"
				variant="subtle"
				icon="i-lucide-alert-circle"
				title="The models could not be loaded"
				:description="error"
				:actions="[{ label: 'Retry', color: 'error', variant: 'outline', onClick: () => emit('retry') }]"
			/>
			<div v-else-if="status === 'pending' && !models.length" class="h-[60vh] flex flex-col gap-3 p-2" aria-busy="true" aria-label="Loading models">
				<USkeleton v-for="n in 8" :key="n" class="h-9 w-full" />
			</div>
			<UTable
				v-else
				sticky
				virtualize
				:data="rows"
				:columns="columns"
				:meta="{ class: { tr: (row: TableRow<Entry>) => row.original.id === selected ? 'bg-elevated' : 'cursor-pointer' } }"
				empty="No model matches."
				class="h-[60vh]"
				@select="choose"
			/>
		</template>
	</UModal>
</template>
