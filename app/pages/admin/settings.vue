<script setup lang="ts">
import type { BrowsableModel } from '~/composables/useModels'

definePageMeta({ minRole: 'admin' })
useHead({ title: 'Admin settings' })

type PlatformId = 'openrouter' | 'deepseek'

const act = useApiAction()
const queryCache = useQueryCache()
const { data: settings } = await useFetch('/api/v1/admin/settings')

const platformNames: Record<PlatformId, string> = { openrouter: 'OpenRouter', deepseek: 'DeepSeek' }
const platformIds: PlatformId[] = ['openrouter', 'deepseek']

type CatalogKind = 'chat' | 'stt'
// Each platform's catalog with its own key, active or not. Loaded in the browser: catalogs are large.
function useAdminCatalog(platform: PlatformId, kind: CatalogKind) {
	return useQuery({
		key: ['admin', 'catalog', platform, kind],
		// Typed by hand: the inferred route type is too deep for `useQuery`.
		query: () => $fetch<{ models: BrowsableModel[] }>('/api/v1/admin/models', { query: { platform, kind } }),
		enabled: () => import.meta.client && !!settings.value?.platforms[platform].hasKey
			&& (kind === 'chat' || settings.value.capabilities[platform].sttModel),
		staleTime: 5 * 60_000,
	})
}
const catalogs = Object.fromEntries(platformIds.map(id => [id, { chat: useAdminCatalog(id, 'chat'), stt: useAdminCatalog(id, 'stt') }])) as Record<PlatformId, Record<CatalogKind, ReturnType<typeof useAdminCatalog>>>

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
const platformForms = reactive(Object.fromEntries(platformIds.map(id => [id, { apiKey: '', defaultModel: '', titleModel: '', sttModel: '' }])) as Record<PlatformId, { apiKey: string, defaultModel: string, titleModel: string, sttModel: string }>)
const safetyCheck = ref(false)
const limits = reactive({ maxChatModels: 4, maxRegenerations: 50, maxRetries: 5 })

function fill(view: NonNullable<typeof settings.value>) {
	settings.value = view
	general.signupMode = view.signupMode
	general.defaultMonthlyBudgetUsd = view.defaultMonthlyBudgetUsd
	Object.assign(limits, { maxChatModels: view.maxChatModels, maxRegenerations: view.maxRegenerations, maxRetries: view.maxRetries })
	active.value = view.inferencePlatform ?? 'none'
	safetyCheck.value = view.safetyCheck
	for (const id of platformIds) {
		const config = view.platforms[id]
		Object.assign(platformForms[id], { apiKey: '', defaultModel: config.defaultModel ?? '', titleModel: config.titleModel ?? '', sttModel: config.sttModel ?? '' })
	}
}
if (settings.value) fill(settings.value)

const saving = ref<string | null>(null)
async function save(section: string, body: Record<string, unknown>) {
	saving.value = section
	const view = await act<NonNullable<typeof settings.value>>('/api/v1/admin/settings', { method: 'PATCH', body, success: 'Settings saved' })
	saving.value = null
	if (view) {
		fill(view)
		// The pickers follow the keys (a failed catalog shows in its picker); the model picker and the home page notice follow the active platform.
		await Promise.all([queryCache.invalidateQueries({ key: ['admin', 'catalog'] }).catch(() => {}), refreshNuxtData('models')])
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
	</AdminPanel>
</template>
