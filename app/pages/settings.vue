<script setup lang="ts">
useHead({ title: 'Settings' })

const act = useApiAction()
const queryCache = useQueryCache()
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

// Shown at once; the previous choice comes back if the server refuses.
async function setStoppedRegenerate(value: string) {
	const before = me.value
	if (!before) return
	queryCache.setQueryData(meQuery.key, { ...before, preferences: { ...before.preferences, stoppedRegenerate: value as typeof before.preferences.stoppedRegenerate } })
	if (!await act('/api/v1/me/preferences', { method: 'PATCH', body: { stoppedRegenerate: value }, success: 'Saved' })) queryCache.setQueryData(meQuery.key, before)
}

const { data: characterList } = useQuery(charactersQuery)
const NONE = 'none'
const characterItems = computed(() => [
	{ label: 'Yourself', value: NONE },
	...(characterList.value ?? []).map(character => ({ label: character.ownerId === null ? `${character.name} (instance)` : character.name, value: character.id })),
])
async function setCharacter(value: string) {
	const before = me.value
	if (!before) return
	const characterId = value === NONE ? null : value
	queryCache.setQueryData(meQuery.key, { ...before, preferences: { ...before.preferences, characterId } })
	if (!await act('/api/v1/me/preferences', { method: 'PATCH', body: { characterId }, success: 'Saved' })) queryCache.setQueryData(meQuery.key, before)
}

// Read-aloud's voice on the active platform; another platform keeps its own.
const { data: speech } = useQuery(speechVoicesQuery)
const voiceItems = computed(() => (speech.value?.voices ?? []).map(voice => ({ label: voice.id === speech.value?.defaultVoice ? `${voice.name} (default)` : voice.name, value: voice.id })))
async function setVoice(voice: string) {
	const current = speech.value
	if (!current?.available) return
	queryCache.setQueryData(speechVoicesQuery.key, { ...current, voice })
	if (!await act('/api/v1/me/preferences', { method: 'PATCH', body: { voices: { [current.platform]: voice } }, success: 'Saved' })) queryCache.setQueryData(speechVoicesQuery.key, current)
}
const { read, stop, readingId } = useReadAloud()
const SAMPLE = 'Hello! This is how answers sound when you have them read aloud.'
function playSample() {
	if (readingId.value === 'sample') stop()
	else read('sample', [{ type: 'text', text: SAMPLE }])
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
					<USkeleton v-else class="h-5 w-48" />
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
					<div v-else class="flex flex-col gap-3">
						<USkeleton class="h-5 w-56" />
						<USkeleton class="h-5 w-56" />
					</div>
				</UPageCard>

				<UPageCard title="You in new chats" description="The Character you are in new chats; each chat can pick another. Its name stands for {{user}} and its instructions tell the models about you." variant="subtle">
					<USelect v-if="me" :model-value="me.preferences.characterId ?? NONE" :items="characterItems" class="w-full sm:w-72" @update:model-value="setCharacter" />
					<USkeleton v-else class="h-8 w-72" />
				</UPageCard>

				<UPageCard title="Read aloud" :description="speech?.available ? `Answers are read in this voice on ${platforms.find(entry => entry.id === speech?.platform)?.name}, the active platform. Listening is billed like a chat.` : 'Read-aloud is not set up on the active platform yet.'" variant="subtle">
					<div v-if="speech?.available" class="flex flex-wrap gap-2">
						<USelect :model-value="speech.voice ?? speech.defaultVoice" :items="voiceItems" class="w-full sm:w-72" aria-label="Voice" @update:model-value="setVoice" />
						<UButton :label="readingId === 'sample' ? 'Stop' : 'Play a sample'" :icon="readingId === 'sample' ? 'i-lucide-square' : 'i-lucide-volume-2'" color="neutral" variant="subtle" @click="playSample" />
					</div>
					<USkeleton v-else-if="!speech" class="h-8 w-72" />
				</UPageCard>

				<UPageCard title="Your chats" description="Every chat you own in one file, a chat file per line, without attachments: for keeping. To move a chat, export it from its menu and import it." variant="subtle">
					<div>
						<UButton label="Export all my chats" icon="i-lucide-download" color="neutral" variant="subtle" to="/api/v1/me/export" external download />
					</div>
				</UPageCard>
			</div>
		</template>
	</UDashboardPanel>
</template>
