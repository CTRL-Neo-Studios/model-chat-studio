<script setup lang="ts">
useHead({ title: 'Settings' })

const act = useApiAction()
const { platform } = useModels()
// Both load at once; the cards fill in as they arrive.
const { data: me, refetch: refreshMe } = useQuery(meQuery)
const { data: usage } = useQuery(usageQuery)

const platforms = [
	{ id: 'openrouter' as const, name: 'OpenRouter', keys: 'https://openrouter.ai/settings/keys' },
	{ id: 'deepseek' as const, name: 'DeepSeek', keys: 'https://platform.deepseek.com/api_keys' },
]

// Budgets run per calendar month in UTC.
const month = computed(() => usage.value ? new Date(usage.value.monthStart).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '')
const share = computed(() => usage.value?.budgetUsd ? Math.min(100, usage.value.spentUsd / usage.value.budgetUsd * 100) : 0)

const keyInput = reactive<Record<string, string>>({ openrouter: '', deepseek: '' })
const saving = ref<string | null>(null)

async function saveKey(id: 'openrouter' | 'deepseek') {
	saving.value = id
	const saved = await act('/api/v1/me/api-key', { method: 'PUT', body: { platform: id, apiKey: keyInput[id] }, success: 'Key saved' })
	saving.value = null
	if (saved) {
		keyInput[id] = ''
		await refreshMe()
	}
}

async function removeKey(id: 'openrouter' | 'deepseek') {
	if (await act(`/api/v1/me/api-key?platform=${id}`, { method: 'DELETE', success: 'Key removed' })) await refreshMe()
}

const stoppedRegenerateItems = [
	{ label: 'Keep the previous answer', value: 'keep-previous', description: 'Stopping a regenerated answer cancels it.' },
	{ label: 'Keep what was generated', value: 'keep-partial', description: 'The unfinished answer replaces the previous one.' },
]

async function setStoppedRegenerate(value: string) {
	if (await act('/api/v1/me/preferences', { method: 'PATCH', body: { stoppedRegenerate: value }, success: 'Saved' })) await refreshMe()
}
</script>

<template>
	<UDashboardPanel id="settings" class="min-h-0">
		<template #header>
			<UDashboardNavbar title="Settings">
				<template #right>
					<UColorModeButton />
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<div class="w-full max-w-2xl mx-auto flex flex-col gap-6">
				<UPageCard title="Usage" :description="`Spending on the shared key in ${month}. Turns on your own key do not count.`" variant="subtle">
					<div v-if="usage" class="flex flex-col gap-2">
						<div class="flex items-baseline justify-between text-sm">
							<span class="text-highlighted font-medium">{{ formatUsd(usage.spentUsd) }} spent</span>
							<span class="text-muted">{{ usage.budgetUsd === null ? 'No monthly limit' : `of ${formatUsd(usage.budgetUsd)}` }}</span>
						</div>
						<UProgress v-if="usage.budgetUsd !== null" :model-value="share" :color="share >= 100 ? 'error' : share >= 80 ? 'warning' : 'primary'" />
						<p v-if="usage.budgetUsd !== null && share >= 100" class="text-sm text-error">
							You have used this month's budget. Add your own key below to keep chatting.
						</p>
					</div>
				</UPageCard>

				<UPageCard title="Your API keys" description="With your own key for the active platform, your chats are billed to your account and do not count against your budget. Keys are stored encrypted and never shown again." variant="subtle">
					<div class="flex flex-col divide-y divide-default">
						<div v-for="entry in platforms" :key="entry.id" class="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
							<div class="flex items-center gap-2">
								<span class="font-medium text-highlighted">{{ entry.name }}</span>
								<UBadge v-if="platform?.id === entry.id" label="Active" size="sm" variant="subtle" />
								<UBadge v-if="me?.apiKeys.includes(entry.id)" label="Key set" color="success" size="sm" variant="subtle" />
								<UButton :to="entry.keys" target="_blank" label="Get a key" trailing-icon="i-lucide-arrow-up-right" size="xs" color="neutral" variant="link" class="ms-auto" />
							</div>
							<div class="flex gap-2">
								<UInput
									v-model="keyInput[entry.id]"
									type="password"
									autocomplete="off"
									:placeholder="me?.apiKeys.includes(entry.id) ? 'Replace your key' : 'Paste your key'"
									class="flex-1"
									@keydown.enter="keyInput[entry.id] && saveKey(entry.id)"
								/>
								<UButton label="Save" :loading="saving === entry.id" :disabled="!keyInput[entry.id]" @click="saveKey(entry.id)" />
								<UButton v-if="me?.apiKeys.includes(entry.id)" label="Remove" color="error" variant="soft" @click="removeKey(entry.id)" />
							</div>
						</div>
					</div>
				</UPageCard>

				<UPageCard title="Chat" description="When you stop an answer that is being regenerated." variant="subtle">
					<URadioGroup
						v-if="me"
						:model-value="me.preferences.stoppedRegenerate"
						:items="stoppedRegenerateItems"
						@update:model-value="setStoppedRegenerate"
					/>
				</UPageCard>
			</div>
		</template>
	</UDashboardPanel>
</template>
