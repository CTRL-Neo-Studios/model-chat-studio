<script setup lang="ts">
definePageMeta({ minRole: 'admin' })
useHead({ title: 'Admin settings' })

type PlatformId = 'openrouter' | 'deepseek'

const act = useApiAction()
const queryCache = useQueryCache()
const { data: settings } = useQuery(adminSettingsQuery)

const platformNames: Record<PlatformId, string> = { openrouter: 'OpenRouter', deepseek: 'DeepSeek' }
const platformIds: PlatformId[] = ['openrouter', 'deepseek']

type CatalogKind = 'chat' | 'stt' | 'decisions' | 'speech' | 'images'
const kindCapability = { stt: 'sttModel', decisions: 'decisions', speech: 'speechModel', images: 'images' } as const
// Each platform's catalog with its own key, active or not. Loaded in the browser: catalogs are large.
function useAdminCatalog(platform: PlatformId, kind: CatalogKind) {
	return useQuery(() => ({
		...adminCatalogQuery({ platform, kind }),
		enabled: import.meta.client && !!settings.value?.platforms[platform].hasKey
			&& (kind === 'chat' || settings.value.capabilities[platform][kindCapability[kind]]),
	}))
}
const catalogs = Object.fromEntries(platformIds.map(id => [id, { chat: useAdminCatalog(id, 'chat'), stt: useAdminCatalog(id, 'stt'), decisions: useAdminCatalog(id, 'decisions'), speech: useAdminCatalog(id, 'speech'), images: useAdminCatalog(id, 'images') }])) as Record<PlatformId, Record<CatalogKind, ReturnType<typeof useAdminCatalog>>>

/** Props for a `ModelField` choosing from one platform's catalog. */
function picker(id: PlatformId, kind: CatalogKind) {
	const { data, status, asyncStatus, error } = catalogs[id][kind]
	return {
		models: data.value?.models ?? [],
		// A retry after an error is loading again.
		status: asyncStatus.value === 'loading' ? 'pending' as const : status.value,
		error: error.value ? serverMessage(error.value) ?? error.value.message : undefined,
		disabledReason: settings.value?.platforms[id].hasKey ? undefined : 'Add a key first',
	}
}

// Form state, filled from the server and refilled from each save's response.
const general = reactive({ signupMode: 'invite' as 'invite' | 'open' | 'closed', defaultMonthlyBudgetUsd: null as number | null })
const active = ref<PlatformId | 'none'>('none')
type PlatformForm = { apiKey: string, defaultModel: string, titleModel: string, sttModel: string, speechModel: string, speechVoice: string, imageModel: string, decisionModel: string }
const platformForms = reactive(Object.fromEntries(platformIds.map(id => [id, { apiKey: '', defaultModel: '', titleModel: '', sttModel: '', speechModel: '', speechVoice: '', imageModel: '', decisionModel: '' }])) as Record<PlatformId, PlatformForm>)
/** The chosen speech model's voices, for the voice select; its first is the default. */
const speechVoices = (id: PlatformId) => (catalogs[id].speech.data.value?.models.find(model => model.id === platformForms[id].speechModel)?.voices ?? []).map(voice => ({ label: voice, value: voice }))
const safetyCheck = ref(false)
const limits = reactive({ maxChatModels: 4, maxRegenerations: 50, maxRetries: 5 })

function fill(view: NonNullable<typeof settings.value>) {
	general.signupMode = view.signupMode
	general.defaultMonthlyBudgetUsd = view.defaultMonthlyBudgetUsd
	Object.assign(limits, { maxChatModels: view.maxChatModels, maxRegenerations: view.maxRegenerations, maxRetries: view.maxRetries })
	active.value = view.inferencePlatform ?? 'none'
	safetyCheck.value = view.safetyCheck
	for (const id of platformIds) {
		const config = view.platforms[id]
		Object.assign(platformForms[id], { apiKey: '', defaultModel: config.defaultModel ?? '', titleModel: config.titleModel ?? '', sttModel: config.sttModel ?? '', speechModel: config.speechModel ?? '', speechVoice: config.speechVoice ?? '', imageModel: config.imageModel ?? '', decisionModel: config.decisionModel ?? '' })
	}
}
// The form fills in once the settings arrive (the page shows skeletons until then); later refreshes leave edits alone.
const stopFilling = watch(settings, (view) => {
	if (!view) return
	fill(view)
	queueMicrotask(() => stopFilling())
}, { immediate: true })

const saving = ref<string | null>(null)
async function save(section: string, body: Record<string, unknown>) {
	saving.value = section
	const view = await act<NonNullable<typeof settings.value>>('/api/v1/admin/settings', { method: 'PATCH', body, success: 'Settings saved' })
	saving.value = null
	if (view) {
		queryCache.setQueryData(adminSettingsQuery.key, view)
		fill(view)
		// The pickers follow the keys (a failed catalog shows in its picker); members' model picker and the home page notice follow the active platform.
		await Promise.all([queryCache.invalidateQueries({ key: ['admin', 'catalog'] }), queryCache.invalidateQueries({ key: modelsQuery.key })]).catch(() => {})
	}
}

function savePlatform(id: PlatformId) {
	const form = platformForms[id]
	const capabilities = settings.value!.capabilities[id]
	return save(id, {
		platforms: {
			[id]: {
				...(form.apiKey.trim() && { apiKey: form.apiKey.trim() }),
				defaultModel: form.defaultModel.trim() || null,
				...(!capabilities.nativeTitle && { titleModel: form.titleModel.trim() || null }),
				...(capabilities.sttModel && { sttModel: form.sttModel.trim() || null }),
				...(capabilities.speechModel && { speechModel: form.speechModel.trim() || null, speechVoice: form.speechModel.trim() && form.speechVoice.trim() ? form.speechVoice.trim() : null }),
				...(capabilities.images && { imageModel: form.imageModel.trim() || null }),
				...(capabilities.decisions && { decisionModel: form.decisionModel.trim() || null }),
			},
		},
		...(capabilities.safetyCheck && { safetyCheck: safetyCheck.value }),
	})
}

const signupModes = [
	{ value: 'invite', label: 'Invite only', description: 'People join with an invite link.' },
	{ value: 'open', label: 'Open', description: 'Anyone with a GitHub account can join.' },
	{ value: 'closed', label: 'Closed', description: 'Nobody can join, not even with an invite.' },
]

const platformChoices = computed(() => [
	{ value: 'none', label: 'None', description: 'Chat is turned off.' },
	...platformIds.map(id => ({
		value: id,
		label: platformNames[id],
		description: settings.value?.platforms[id].hasKey ? 'Instance key set.' : 'No instance key: only members with their own key can chat.',
	})),
])
</script>

<template>
	<AdminPanel title="Settings">
		<template v-if="settings">
			<UPageCard title="Members" variant="subtle">
				<UFormField label="Signup">
					<URadioGroup v-model="general.signupMode" :items="signupModes" />
				</UFormField>
				<UFormField label="Default monthly budget" description="USD per member per month on the instance key. A member's own budget wins; empty is unlimited.">
					<UInputNumber v-model="general.defaultMonthlyBudgetUsd" :min="0" :step="1" :format-options="{ style: 'currency', currency: 'USD' }" placeholder="Unlimited" class="w-48" />
				</UFormField>
				<div>
					<UButton label="Save" :loading="saving === 'general'" @click="save('general', { ...general })" />
				</div>
			</UPageCard>

			<UPageCard title="Limits" variant="subtle">
				<UFormField label="Models per chat" description="How many models can answer each message in one chat. Each answer is billed separately.">
					<UInputNumber v-model="limits.maxChatModels" :min="1" :max="12" class="w-32" />
				</UFormField>
				<UFormField label="Regenerations per answer" description="After this many, the answer can no longer be regenerated.">
					<UInputNumber v-model="limits.maxRegenerations" :min="1" :max="1000" class="w-32" />
				</UFormField>
				<UFormField label="Automatic retries" description="How often a call the platform refused or failed (rate limits, server errors) is retried before the member sees an error.">
					<UInputNumber v-model="limits.maxRetries" :min="0" :max="10" class="w-32" />
				</UFormField>
				<div>
					<UButton label="Save" :loading="saving === 'limits'" @click="save('limits', { ...limits })" />
				</div>
			</UPageCard>

			<UPageCard title="Model platform" description="Chats use the active platform. Each platform keeps its own key and models, so switching back restores them." variant="subtle">
				<URadioGroup v-model="active" :items="platformChoices" />
				<div>
					<UButton label="Save" :loading="saving === 'platform'" @click="save('platform', { inferencePlatform: active === 'none' ? null : active })" />
				</div>
			</UPageCard>

			<UPageCard v-for="id in platformIds" :key="id" :title="platformNames[id]" variant="subtle">
				<template #description>
					<span class="flex items-center gap-2">
						<UBadge v-if="settings.inferencePlatform === id" label="Active" size="sm" variant="subtle" />
						<UBadge :label="settings.platforms[id].hasKey ? 'Key set' : 'No key'" :color="settings.platforms[id].hasKey ? 'success' : 'warning'" size="sm" variant="subtle" />
					</span>
				</template>

				<UFormField label="API key" description="Checked with the platform before it is saved; stored encrypted and never shown again.">
					<div class="flex gap-2">
						<UInput v-model="platformForms[id].apiKey" type="password" autocomplete="off" :placeholder="settings.platforms[id].hasKey ? 'Replace the key' : 'Paste a key'" class="flex-1" />
						<UButton
							v-if="settings.platforms[id].hasKey"
							label="Remove key"
							color="error"
							variant="soft"
							@click="save(id, { platforms: { [id]: { apiKey: null } } })"
						/>
					</div>
				</UFormField>

				<UFormField label="Default model" description="For new chats, and for chats whose model is no longer offered.">
					<ModelField
						v-bind="picker(id, 'chat')"
						:model-value="platformForms[id].defaultModel || null"
						placeholder="Choose the default model"
						clearable
						@update:model-value="platformForms[id].defaultModel = $event ?? ''"
						@retry="catalogs[id].chat.refetch()"
					/>
				</UFormField>

				<UFormField v-if="!settings.capabilities[id].nativeTitle" label="Title model" description="Names new chats with a short call; empty uses the start of the first message.">
					<ModelField
						v-bind="picker(id, 'chat')"
						:model-value="platformForms[id].titleModel || null"
						placeholder="None: the start of the first message"
						clearable
						@update:model-value="platformForms[id].titleModel = $event ?? ''"
						@retry="catalogs[id].chat.refetch()"
					/>
				</UFormField>

				<UFormField v-if="settings.capabilities[id].sttModel" label="Speech-to-text model" description="Dictation is off until one is set.">
					<ModelField
						v-bind="picker(id, 'stt')"
						:model-value="platformForms[id].sttModel || null"
						placeholder="None: dictation is off"
						clearable
						@update:model-value="platformForms[id].sttModel = $event ?? ''"
						@retry="catalogs[id].stt.refetch()"
					/>
				</UFormField>

				<UFormField v-if="settings.capabilities[id].speechModel" label="Text-to-speech model" description="Reads answers aloud for whoever listens, billed to them. Read-aloud is off until one is set.">
					<ModelField
						v-bind="picker(id, 'speech')"
						:model-value="platformForms[id].speechModel || null"
						placeholder="None: read-aloud is off"
						clearable
						@update:model-value="platformForms[id].speechModel = $event ?? ''; platformForms[id].speechVoice = ''"
						@retry="catalogs[id].speech.refetch()"
					/>
				</UFormField>

				<UFormField v-if="settings.capabilities[id].speechModel && platformForms[id].speechModel" label="Default voice" description="For members who have not chosen their own.">
					<USelect
						:model-value="platformForms[id].speechVoice || speechVoices(id)[0]?.value"
						:items="speechVoices(id)"
						placeholder="The model's first voice"
						class="w-64"
						@update:model-value="platformForms[id].speechVoice = $event ?? ''"
					/>
				</UFormField>

				<UFormField v-if="settings.capabilities[id].images" label="Image model" description="Draws the images models make, whichever platform answers, billed to the member. Images are off until one is set.">
					<ModelField
						v-bind="picker(id, 'images')"
						:model-value="platformForms[id].imageModel || null"
						placeholder="None: images are off"
						clearable
						@update:model-value="platformForms[id].imageModel = $event ?? ''"
						@retry="catalogs[id].images.refetch()"
					/>
				</UFormField>

				<UFormField
					v-if="settings.capabilities[id].decisions"
					label="Decision model"
					description="Picks who answers in group chats when a message names nobody with “@”. Used whenever an OpenRouter key is stored, even while another platform answers. Suggested: TypeSafe Jev (typesafe/jev-1.14)."
				>
					<ModelField
						v-bind="picker(id, 'decisions')"
						:model-value="platformForms[id].decisionModel || null"
						placeholder="None: names in the message decide"
						clearable
						@update:model-value="platformForms[id].decisionModel = $event ?? ''"
						@retry="catalogs[id].decisions.refetch()"
					/>
				</UFormField>

				<template v-if="settings.capabilities[id].safetyCheck">
					<USwitch v-model="safetyCheck" label="Safety check" description="DeepSeek reviews messages and answers for harmful content." />
					<UAlert
						v-if="safetyCheck"
						color="warning"
						variant="subtle"
						icon="i-lucide-shield-alert"
						title="Before turning this on"
					>
						<template #description>
							<ul class="list-disc ps-4 space-y-0.5">
								<li>DeepSeek reviews every message and every answer.</li>
								<li>A flagged answer is replaced by a refusal, even after part of it has streamed.</li>
								<li>Review tokens are billed as output tokens.</li>
								<li>Temperature and top-p are ignored while it is on.</li>
								<li>DeepSeek recommends turning it on for a service open to the public.</li>
							</ul>
						</template>
					</UAlert>
				</template>

				<div>
					<UButton label="Save" :loading="saving === id" @click="savePlatform(id)" />
				</div>
			</UPageCard>
		</template>
		<div v-else class="flex flex-col gap-4" aria-busy="true" aria-label="Loading the settings">
			<USkeleton v-for="n in 4" :key="n" class="h-40 w-full" />
		</div>
	</AdminPanel>
</template>
