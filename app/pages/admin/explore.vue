<script setup lang="ts">
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import { formatDistanceToNow } from 'date-fns'
import { LazyModalConfirm, LazyModalRename } from '#components'

definePageMeta({ minRole: 'moderator' })
useHead({ title: 'Explore' })

const act = useApiAction()
const overlay = useOverlay()
const queryCache = useQueryCache()
const { data: settings } = useQuery(exploreSettingsQuery)
const { data, isPending, refetch } = useQuery(adminListingsQuery)
const listings = computed(() => data.value ?? [])
type Row = (typeof listings.value)[number]

// The form fills in from the server, and again from each save's answer.
const form = reactive({ publishing: 'open' as 'open' | 'reviewed' | 'off', categories: [] as string[], maxSizeMb: 25 })
// Switching modes leaves what is listed as it is, and what waits still waits: each is approved or rejected.
const MODES = [
	{ label: 'Open', value: 'open', description: 'Published at once.' },
	{ label: 'Reviewed', value: 'reviewed', description: 'Each publication and update waits for an admin or moderator to approve it (never their own).' },
	{ label: 'Off', value: 'off', description: 'Only admins and moderators publish.' },
]
watch(settings, (value) => {
	if (value) Object.assign(form, { publishing: value.publishing, categories: [...value.categories], maxSizeMb: value.maxSizeMb })
}, { immediate: true })
const saving = ref(false)
async function save() {
	saving.value = true
	const saved = await act<typeof form>('/api/v1/explore/settings', { method: 'PATCH', body: { ...form }, success: 'Explore settings saved' })
	saving.value = false
	if (saved) queryCache.setQueryData(exploreSettingsQuery.key, saved)
}

const STATUS = {
	listed: { label: 'Published', color: 'success' },
	unlisted: { label: 'Unpublished', color: 'neutral' },
	removed: { label: 'Removed', color: 'error' },
} as const
const columns: TableColumn<Row>[] = [
	{ id: 'listing', header: 'Listing' },
	{ id: 'status', header: 'Status' },
	{ accessorKey: 'gets', header: 'Got by' },
	{ accessorKey: 'publishedAt', header: 'Published', cell: ({ row }) => formatDistanceToNow(new Date(row.original.publishedAt), { addSuffix: true }) },
	{ id: 'actions' },
]

const reasonModal = overlay.create(LazyModalRename)
const confirm = overlay.create(LazyModalConfirm)
async function change(row: Row, body: Record<string, unknown>, success: string) {
	if (await act(`/api/v1/explore/listings/${row.id}`, { method: 'PATCH', body, success })) await refetch()
}
async function remove(row: Row) {
	const reason = await reasonModal.open({ heading: `Remove “${row.name}”`, description: 'It leaves Explore. Its publisher sees why, and can only delete it; you can restore it later.', placeholder: 'Why it is removed', maxlength: 500 }).result
	if (reason) await change(row, { status: 'removed', statusReason: reason }, 'Listing removed')
}
async function destroy(row: Row) {
	if (!await confirm.open({ title: `Delete “${row.name}”?`, description: 'It leaves Explore with all its versions. Copies people got stay theirs.', color: 'error' }).result) return
	if (await act(`/api/v1/explore/listings/${row.id}`, { method: 'DELETE', success: 'Listing deleted' })) await refetch()
}
const actions = (row: Row): DropdownMenuItem[][] => [[
	{ label: 'Open', icon: 'i-lucide-external-link', to: `/explore/${row.id}` },
	{ label: row.featured ? 'Stop featuring' : 'Feature', icon: 'i-lucide-star', onSelect: () => change(row, { featured: !row.featured }, row.featured ? 'No longer featured' : 'Featured: shown first on Explore') },
	row.status === 'removed'
		? { label: 'Restore', icon: 'i-lucide-undo-2', onSelect: () => change(row, { status: 'listed' }, 'Listing restored') }
		: { label: 'Remove…', icon: 'i-lucide-shield-alert', onSelect: () => remove(row) },
], [{ label: 'Delete', icon: 'i-lucide-trash', color: 'error' as const, onSelect: () => destroy(row) }]]
</script>

<template>
	<AdminPanel title="Explore">
		<UPageCard title="Publishing" description="Members browse and get in every mode." variant="subtle">
			<div v-if="settings" class="flex flex-col gap-4">
				<URadioGroup v-model="form.publishing" :items="MODES" legend="Mode" />
				<UFormField label="Categories" help="A listing may pick one. Removing one leaves the listings that use it as they are.">
					<UInputTags v-model="form.categories" placeholder="Add a category" :max="30" :max-length="40" add-on-blur class="w-full" />
				</UFormField>
				<UFormField label="Largest listing, with its files (MB)" help="At most 25.">
					<UInputNumber v-model="form.maxSizeMb" :min="1" :max="25" class="w-32" />
				</UFormField>
				<div>
					<UButton label="Save" :loading="saving" @click="save" />
				</div>
			</div>
			<USkeleton v-else class="h-40 w-full" />
		</UPageCard>

		<UTable :data="listings" :columns="columns" :loading="isPending">
			<template #listing-cell="{ row }">
				<div class="flex items-center gap-3 min-w-0">
					<UIcon :name="LISTING_KINDS[row.original.kind].icon" class="size-5 text-muted shrink-0" />
					<div class="min-w-0">
						<p class="text-highlighted truncate flex items-center gap-1">
							{{ row.original.name }}
							<UIcon v-if="row.original.featured" name="i-lucide-star" class="size-3.5 text-warning" aria-label="Featured" />
						</p>
						<p class="text-xs text-muted truncate">
							{{ LISTING_KINDS[row.original.kind].label }} by {{ row.original.publisher.name || row.original.publisher.username }} · version {{ row.original.version }}
						</p>
					</div>
				</div>
			</template>
			<template #status-cell="{ row }">
				<UBadge :label="STATUS[row.original.status].label" :color="STATUS[row.original.status].color" variant="subtle" />
				<p v-if="row.original.statusReason" class="text-xs text-muted mt-1 max-w-64 whitespace-normal">
					{{ row.original.statusReason }}
				</p>
			</template>
			<template #actions-cell="{ row }">
				<UDropdownMenu :items="actions(row.original)" :content="{ align: 'end' }">
					<UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="sm" :aria-label="`Actions for ${row.original.name}`" />
				</UDropdownMenu>
			</template>
			<template #empty>
				<UEmpty icon="i-lucide-telescope" title="Nothing published yet" description="Listings members publish show here, whatever their status." />
			</template>
		</UTable>
	</AdminPanel>
</template>
