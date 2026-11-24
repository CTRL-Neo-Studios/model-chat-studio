<script setup lang="ts">
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import { LazyModalConfirm } from '#components'

definePageMeta({ minRole: 'moderator' })
useHead({ title: 'Users' })

const act = useApiAction()
const overlay = useOverlay()
const { user: me } = useUserSession()
const { data, isPending, refetch: refresh } = useQuery(usersQuery)
const users = computed(() => data.value ?? [])
type Row = (typeof users.value)[number]

const isAdmin = computed(() => me.value?.role === 'admin')
const search = ref('')
const rows = computed(() => {
	const term = search.value.trim().toLowerCase()
	return users.value
		.filter(row => !term || row.username.toLowerCase().includes(term) || row.name?.toLowerCase().includes(term))
		.sort((a, b) => a.createdAt < b.createdAt ? -1 : 1)
})

/** An expired ban no longer counts, as on the server. */
const isBanned = (row: Row) => row.banned && (!row.banExpires || new Date(row.banExpires) > new Date())
// Role actions apply only to someone of strictly lower role, which also excludes oneself.
const canActOn = (row: Row) => !!me.value && getRoleLevel(me.value.role) > getRoleLevel(row.role)

const columns: TableColumn<Row>[] = [
	{ id: 'user', header: 'Member' },
	{ accessorKey: 'role', header: 'Role' },
	{ id: 'status', header: 'Status' },
	{ id: 'budget', header: 'Monthly budget' },
	{ accessorKey: 'createdAt', header: 'Joined', cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString() },
	{ id: 'actions' },
]

async function change(row: Row, path: string, success: string, body?: Record<string, unknown>) {
	if (await act(`/api/v1/users/${row.id}${path}`, { method: 'PATCH', body, success })) await refresh()
}

// Ban dialog
const banTarget = ref<Row | null>(null)
const ban = reactive({ reason: '', days: undefined as number | undefined })
function openBan(row: Row) {
	ban.reason = ''
	ban.days = undefined
	banTarget.value = row
}
async function confirmBan() {
	const row = banTarget.value!
	banTarget.value = null
	await change(row, '/ban', `${row.username} is banned`, {
		banReason: ban.reason.trim() || undefined,
		banExpires: ban.days ? new Date(Date.now() + ban.days * 86_400_000).toISOString() : undefined,
	})
}

// Budget dialog
const budgetTarget = ref<Row | null>(null)
const budget = ref<number | null>(null)
function openBudget(row: Row) {
	budget.value = row.monthlyBudgetUsd
	budgetTarget.value = row
}
async function confirmBudget() {
	const row = budgetTarget.value!
	budgetTarget.value = null
	await change(row, '', 'Budget saved', { monthlyBudgetUsd: budget.value })
}

const deleteModal = overlay.create(LazyModalConfirm)
async function remove(row: Row) {
	const confirmed = await deleteModal.open({
		title: `Delete ${row.username}?`,
		description: 'Their chats, files and keys are deleted too. They can sign up again if signup allows it.',
		color: 'error',
	}).result
	if (confirmed && await act(`/api/v1/users/${row.id}`, { method: 'DELETE', success: `${row.username} was deleted` })) await refresh()
}

function actions(row: Row): DropdownMenuItem[][] {
	const groups: DropdownMenuItem[][] = []
	if (canActOn(row)) {
		groups.push([isBanned(row)
			? { label: 'Unban', icon: 'i-lucide-lock-open', onSelect: () => change(row, '/unban', `${row.username} is unbanned`) }
			: { label: 'Ban…', icon: 'i-lucide-ban', onSelect: () => openBan(row) }])
	}
	if (isAdmin.value) {
		groups.push([
			{ label: 'Set budget…', icon: 'i-lucide-wallet', onSelect: () => openBudget(row) },
			...(row.role === 'user' ? [{ label: 'Make moderator', icon: 'i-lucide-shield-plus', onSelect: () => change(row, '/promote', `${row.username} is a moderator`) }] : []),
			...(row.role === 'moderator' ? [{ label: 'Remove moderator', icon: 'i-lucide-shield-minus', onSelect: () => change(row, '/demote', `${row.username} is a member`) }] : []),
		])
		if (canActOn(row)) groups.push([{ label: 'Delete…', icon: 'i-lucide-trash', color: 'error', onSelect: () => remove(row) }])
	}
	return groups
}

const roleColors = { admin: 'primary', moderator: 'info', user: 'neutral' } as const
</script>

<template>
	<AdminPanel title="Users">
		<UInput v-model="search" icon="i-lucide-search" placeholder="Search by name or username" class="max-w-xs" />

		<UTable :data="rows" :columns="columns" :loading="isPending">
			<template #user-cell="{ row }">
				<div class="flex items-center gap-3">
					<UAvatar :src="row.original.avatarUrl || undefined" :alt="row.original.username" size="sm" />
					<div class="min-w-0">
						<p class="text-highlighted truncate">
							{{ row.original.name || row.original.username }}
						</p>
						<p class="text-xs text-muted truncate">
							@{{ row.original.username }}
						</p>
					</div>
				</div>
			</template>

			<template #role-cell="{ row }">
				<UBadge :label="row.original.role" :color="roleColors[row.original.role]" variant="subtle" class="capitalize" />
			</template>

			<template #status-cell="{ row }">
				<UTooltip v-if="isBanned(row.original)" :text="[row.original.banReason, row.original.banExpires ? `until ${new Date(row.original.banExpires).toLocaleDateString()}` : 'no end date'].filter(Boolean).join(' · ')">
					<UBadge label="Banned" color="error" variant="subtle" />
				</UTooltip>
				<UBadge v-else label="Active" color="success" variant="subtle" />
			</template>

			<template #budget-cell="{ row }">
				<span :class="row.original.monthlyBudgetUsd === null && 'text-muted'">
					{{ row.original.monthlyBudgetUsd === null ? 'Default' : formatUsd(row.original.monthlyBudgetUsd) }}
				</span>
			</template>

			<template #actions-cell="{ row }">
				<div class="flex justify-end">
					<UDropdownMenu v-if="actions(row.original).length" :items="actions(row.original)" :content="{ align: 'end' }">
						<UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" :aria-label="`Actions for ${row.original.username}`" />
					</UDropdownMenu>
				</div>
			</template>
		</UTable>

		<UModal :open="!!banTarget" :title="`Ban ${banTarget?.username}`" description="They are signed out of the API at once and cannot sign in again until unbanned." @update:open="!$event && (banTarget = null)">
			<template #body>
				<div class="flex flex-col gap-4">
					<UFormField label="Reason" hint="Optional">
						<UInput v-model="ban.reason" class="w-full" />
					</UFormField>
					<UFormField label="Lifts after" hint="Optional" description="Days; leave empty for no end date.">
						<UInputNumber v-model="ban.days" :min="1" :max="3650" placeholder="Never" class="w-full" />
					</UFormField>
				</div>
			</template>
			<template #footer>
				<div class="flex gap-2 justify-end w-full">
					<UButton label="Cancel" color="neutral" variant="ghost" @click="banTarget = null" />
					<UButton label="Ban" color="error" @click="confirmBan" />
				</div>
			</template>
		</UModal>

		<UModal :open="!!budgetTarget" :title="`Monthly budget for ${budgetTarget?.username}`" description="USD per calendar month on the shared key. Leave empty to use the default from the settings." @update:open="!$event && (budgetTarget = null)">
			<template #body>
				<UInputNumber v-model="budget" :min="0" :step="1" :format-options="{ style: 'currency', currency: 'USD' }" placeholder="Default" class="w-full" />
			</template>
			<template #footer>
				<div class="flex gap-2 justify-end w-full">
					<UButton label="Cancel" color="neutral" variant="ghost" @click="budgetTarget = null" />
					<UButton label="Save" @click="confirmBudget" />
				</div>
			</template>
		</UModal>
	</AdminPanel>
</template>
