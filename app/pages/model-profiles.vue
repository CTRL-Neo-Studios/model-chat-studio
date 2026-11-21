<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { LaneFields } from '#shared/utils/chat'
import { LazyModalConfirm, LazyModelBrowser, LazyModelProfileEditor } from '#components'

useHead({ title: 'Model profiles' })

type Draft = Omit<LaneFields, 'enabled'>

const act = useApiAction()
const overlay = useOverlay()
const { user } = useUserSession()
const { platform, models } = useModels()
const { data, isPending, refetch: refresh } = useQuery(modelProfilesQuery)
const profiles = computed(() => data.value ?? [])
type Profile = (typeof profiles.value)[number]

const isAdmin = computed(() => user.value?.role === 'admin')
const tab = ref<'mine' | 'instance'>('mine')
const tabs = [
	{ label: 'Mine', value: 'mine', icon: 'i-lucide-user' },
	{ label: 'Instance', value: 'instance', icon: 'i-lucide-building' },
]
const shown = computed(() => profiles.value.filter(profile => (profile.ownerId === null) === (tab.value === 'instance')))
const canEdit = computed(() => tab.value === 'mine' || isAdmin.value)

const browser = overlay.create(LazyModelBrowser)
const editor = overlay.create(LazyModelProfileEditor)
const confirm = overlay.create(LazyModalConfirm)

const modelName = (profile: Profile) => models.value.find(entry => entry.id === profile.modelId)?.name ?? profile.modelId
const fields = ({ name, color, modelId, systemPrompt, params }: Profile | Draft) => ({ name, color, modelId, systemPrompt, params })

/** Quick add: pick a model, and the profile is named after it. */
async function quickAdd() {
	const modelId = await browser.open({ models: models.value, title: 'Add a model profile' }).result
	if (!modelId) return
	if (await act('/api/v1/model-profiles', { method: 'POST', body: { modelId, instance: tab.value === 'instance' || undefined }, success: 'Profile added' })) await refresh()
}

async function edit(profile: Profile) {
	const draft = await editor.open({ title: 'Edit profile', profile: fields(profile), models: models.value }).result
	if (draft && await act(`/api/v1/model-profiles/${profile.id}`, { method: 'PATCH', body: fields(draft), success: 'Profile saved' })) await refresh()
}

/** Copies a profile: an instance profile into one's own, or (admins) one's own into the instance profiles. */
async function copy(profile: Profile, instance: boolean) {
	const saved = await act('/api/v1/model-profiles', { method: 'POST', body: { ...fields(profile), instance: instance || undefined }, success: instance ? 'Published for everyone' : 'Copied to your profiles' })
	if (saved) await refresh()
}

async function remove(profile: Profile) {
	const confirmed = await confirm.open({ title: 'Delete profile', description: `"${profile.name}" will be deleted. Chats started from it keep their settings.`, color: 'error' }).result
	if (confirmed && await act(`/api/v1/model-profiles/${profile.id}`, { method: 'DELETE', success: 'Profile deleted' })) await refresh()
}

function actions(profile: Profile): DropdownMenuItem[][] {
	const mine = profile.ownerId !== null
	return [[
		{ label: 'Start a chat', icon: 'i-lucide-message-circle-plus', to: { path: '/', query: { profile: profile.id } } },
		...(canEdit.value ? [{ label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => edit(profile) }] : []),
		mine
			? (isAdmin.value ? [{ label: 'Publish for everyone', icon: 'i-lucide-share', onSelect: () => copy(profile, true) }] : [])
			: [{ label: 'Copy to my profiles', icon: 'i-lucide-copy', onSelect: () => copy(profile, false) }],
	].flat(), ...(canEdit.value ? [[{ label: 'Delete', icon: 'i-lucide-trash', color: 'error' as const, onSelect: () => remove(profile) }]] : [])]
}
</script>

<template>
	<UDashboardPanel id="model-profiles" class="min-h-0">
		<template #header>
			<UDashboardNavbar title="Model profiles">
				<template #right>
					<UButton v-if="canEdit" icon="i-lucide-plus" label="Add model" :disabled="!platform" @click="quickAdd" />
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<div class="w-full max-w-2xl mx-auto flex flex-col gap-4">
				<p class="text-sm text-muted">
					A profile is a model with its settings and system prompt. Start a chat from one; changes made in a chat stay in that chat.
				</p>
				<UTabs v-model="tab" :items="tabs" :content="false" class="w-full" />

				<UEmpty
					v-if="!shown.length && !isPending"
					icon="i-lucide-bot"
					:title="tab === 'mine' ? 'No profiles yet' : 'No instance profiles'"
					:description="tab === 'mine' ? 'Add a model to make your first profile.' : isAdmin ? 'Publish a profile for every member.' : 'An admin can publish profiles for everyone.'"
				/>
				<ul v-else-if="shown.length" class="flex flex-col divide-y divide-default rounded-md border border-default">
					<li v-for="profile in shown" :key="profile.id" class="flex items-center gap-3 px-4 py-3">
						<span :class="['size-2.5 rounded-full shrink-0', profile.color ? LANE_COLOR_CLASSES[profile.color as keyof typeof LANE_COLOR_CLASSES] : 'bg-(--ui-border-accented)']" />
						<div class="flex flex-col min-w-0 flex-1">
							<span class="font-medium text-highlighted truncate">{{ profile.name }}</span>
							<span class="text-sm text-muted truncate">
								{{ modelName(profile) }}<template v-if="profile.systemPrompt"> · custom system prompt</template>
							</span>
						</div>
						<UBadge v-if="platform && profile.platform !== platform.id" label="Other platform" color="warning" variant="subtle" size="sm" />
						<UDropdownMenu :items="actions(profile)" :content="{ align: 'end' }">
							<UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" aria-label="Profile actions" />
						</UDropdownMenu>
					</li>
				</ul>
			</div>
		</template>
	</UDashboardPanel>
</template>
