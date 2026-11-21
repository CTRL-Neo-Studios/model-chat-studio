<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ minRole: 'admin' })
useHead({ title: 'Invites' })

const act = useApiAction()
const { data: invites, refresh } = await useFetch('/api/v1/admin/invites', { default: () => [] })
type Row = (typeof invites.value)[number]

const form = reactive({ maxUses: 1, expiresInDays: '7' })
const expiryOptions = [
	{ label: '1 day', value: '1' },
	{ label: '7 days', value: '7' },
	{ label: '30 days', value: '30' },
	{ label: 'Never', value: 'never' },
]

/** The link of the invite just created; the server keeps only a hash, so it is shown this once. */
const created = ref<string | null>(null)
const { copy, copied } = useClipboard({ copiedDuring: 2000 })

async function create() {
	const result = await act<{ url: string }>('/api/v1/admin/invites', {
		method: 'POST',
		body: { maxUses: form.maxUses, expiresInDays: form.expiresInDays === 'never' ? null : Number(form.expiresInDays) },
	})
	if (!result) return
	created.value = result.url
	await refresh()
}

async function revoke(row: Row) {
	if (await act(`/api/v1/admin/invites/${row.id}`, { method: 'DELETE', success: 'Invite revoked' })) await refresh()
}

function status(row: Row): { label: string, color: 'success' | 'neutral' | 'error' | 'warning' } {
	if (row.revokedAt) return { label: 'Revoked', color: 'error' }
	if (row.expiresAt && new Date(row.expiresAt) <= new Date()) return { label: 'Expired', color: 'neutral' }
	if (row.useCount >= row.maxUses) return { label: 'Used up', color: 'warning' }
	return { label: 'Active', color: 'success' }
}

const columns: TableColumn<Row>[] = [
	{ accessorKey: 'createdAt', header: 'Created', cell: ({ row }) => new Date(row.original.createdAt).toLocaleString() },
	{ id: 'uses', header: 'Uses', cell: ({ row }) => `${row.original.useCount} of ${row.original.maxUses}` },
	{ accessorKey: 'expiresAt', header: 'Expires', cell: ({ row }) => row.original.expiresAt ? new Date(row.original.expiresAt).toLocaleString() : 'Never' },
	{ id: 'status', header: 'Status' },
	{ id: 'actions' },
]
</script>

<template>
	<AdminPanel title="Invites">
		<UPageCard title="New invite" description="Anyone with the link can sign up with GitHub while it is valid, even when signup is invite-only." variant="subtle">
			<div class="flex flex-wrap items-end gap-3">
				<UFormField label="Uses">
					<UInputNumber v-model="form.maxUses" :min="1" :max="1000" class="w-32" />
				</UFormField>
				<UFormField label="Expires after">
					<USelect v-model="form.expiresInDays" :items="expiryOptions" class="w-36" />
				</UFormField>
				<UButton label="Create link" icon="i-lucide-link" @click="create" />
			</div>

			<UAlert
				v-if="created"
				color="success"
				variant="subtle"
				icon="i-lucide-ticket"
				title="Copy the link now: it cannot be shown again."
				:description="created"
				:actions="[{ label: copied ? 'Copied!' : 'Copy link', color: 'success', variant: 'solid', onClick: () => copy(created!) }]"
				close
				@update:open="created = null"
			/>
		</UPageCard>

		<UTable :data="invites" :columns="columns">
			<template #status-cell="{ row }">
				<UBadge :label="status(row.original).label" :color="status(row.original).color" variant="subtle" />
			</template>
			<template #actions-cell="{ row }">
				<div class="flex justify-end">
					<UButton v-if="status(row.original).label === 'Active'" label="Revoke" color="error" variant="ghost" size="sm" @click="revoke(row.original)" />
				</div>
			</template>
			<template #empty>
				<p class="text-sm text-muted">
					No invites yet.
				</p>
			</template>
		</UTable>
	</AdminPanel>
</template>
