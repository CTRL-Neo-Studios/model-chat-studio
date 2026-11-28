<script setup lang="ts">
useHead({ title: 'Chat settings' })

const act = useApiAction()
const queryCache = useQueryCache()
const { data: me } = useQuery(meQuery)

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
const PLATFORM_NAMES = { openrouter: 'OpenRouter', deepseek: 'DeepSeek' } as const
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

async function setLongPaste(longPaste: number | null) {
	const before = me.value
	if (!before || longPaste === null || longPaste === before.preferences.longPaste) return
	queryCache.setQueryData(meQuery.key, { ...before, preferences: { ...before.preferences, longPaste } })
	if (!await act('/api/v1/me/preferences', { method: 'PATCH', body: { longPaste }, success: 'Saved' })) queryCache.setQueryData(meQuery.key, before)
}
</script>

<template>
	<UDashboardPanel id="settings-chat" class="min-h-0">
		<template #header>
			<PageNavbar />
		</template>

		<template #body>
			<div class="w-full max-w-2xl mx-auto flex flex-col gap-6">
				<UPageCard title="Stopping a regenerated answer" description="When you stop an answer that is being regenerated." variant="subtle">
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

				<UPageCard title="Read aloud" :description="speech?.available ? `Answers are read in this voice on ${PLATFORM_NAMES[speech.platform]}, the active platform. Listening is billed like a chat.` : 'Read-aloud is not set up on the active platform yet.'" variant="subtle">
					<div v-if="speech?.available" class="flex flex-wrap gap-2">
						<USelect :model-value="speech.voice ?? speech.defaultVoice" :items="voiceItems" class="w-full sm:w-72" aria-label="Voice" @update:model-value="setVoice" />
						<UButton :label="readingId === 'sample' ? 'Stop' : 'Play a sample'" :icon="readingId === 'sample' ? 'i-lucide-square' : 'i-lucide-volume-2'" color="neutral" variant="subtle" @click="playSample" />
					</div>
					<USkeleton v-else-if="!speech" class="h-8 w-72" />
				</UPageCard>

				<UPageCard title="Long pastes" description="A paste longer than this asks whether it goes into the prompt as text or is attached as a text file. 0 never asks." variant="subtle">
					<UInputNumber v-if="me" :model-value="me.preferences.longPaste" :min="0" :max="1000000" :step="500" class="w-full sm:w-48" aria-label="Characters" @update:model-value="setLongPaste" />
					<USkeleton v-else class="h-8 w-48" />
				</UPageCard>
			</div>
		</template>
	</UDashboardPanel>
</template>
