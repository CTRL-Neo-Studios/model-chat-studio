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
const queryCache = useQueryCache()
const { pinnedFirst } = usePins()
const { data, isPending, refetch: refresh } = useQuery(modelProfilesQuery)
const profiles = computed(() => data.value ?? [])
type Profile = (typeof profiles.value)[number]

const isAdmin = computed(() => user.value?.role === 'admin')
const tab = ref<'mine' | 'instance'>('mine')
const tabs = [
	{ label: 'Mine', value: 'mine', icon: 'i-lucide-user' },
	{ label: 'Instance', value: 'instance', icon: 'i-lucide-building' },
]
const shown = computed(() => pinnedFirst('modelProfile', profiles.value.filter(profile => (profile.ownerId === null) === (tab.value === 'instance'))))
const canEdit = computed(() => tab.value === 'mine' || isAdmin.value)

const browser = overlay.create(LazyModelBrowser)
const editor = overlay.create(LazyModelProfileEditor)
const confirm = overlay.create(LazyModalConfirm)

const modelName = (profile: Profile) => models.value.find(entry => entry.id === profile.modelId)?.name ?? profile.modelId
const { data: characterList } = useQuery(charactersQuery)
const characterName = (profile: Profile) => profile.characterId ? characterList.value?.find(character => character.id === profile.characterId)?.name : undefined
const fields = ({ name, color, modelId, systemPrompt, params, characterId }: Profile | Draft) => ({ name, color, modelId, systemPrompt, params, characterId })

/** Adding and copying need the server's new profile; the add button shows the wait. */
const adding = ref(false)
async function create(body: Record<string, unknown>, success: string) {
	adding.value = true
	if (await act('/api/v1/model-profiles', { method: 'POST', body, success })) await refresh()
	adding.value = false
}

/** Quick add: pick a model, and the profile is named after it. */
async function quickAdd() {
	const modelId = await browser.open({ models: models.value, title: 'Add a model profile' }).result
	if (modelId) await create({ modelId, instance: tab.value === 'instance' || undefined }, 'Profile added')
}

/** Copies a profile: an instance profile into one's own, or (admins) one's own into the instance profiles. */
function copy(profile: Profile, instance: boolean) {
	return create({ ...fields(profile), instance: instance || undefined }, instance ? 'Published for everyone' : 'Copied to your profiles')
}

// Edits and deletions show at once; the list comes back as it was if the server refuses.
async function change(next: Profile[], send: () => Promise<unknown>) {
	const before = profiles.value
	queryCache.setQueryData(modelProfilesQuery.key, next)
	if (!await send()) queryCache.setQueryData(modelProfilesQuery.key, before)
}

async function edit(profile: Profile) {
	const draft = await editor.open({ title: 'Edit profile', profile: fields(profile), models: models.value }).result
	if (!draft) return
	const edited = { ...profile, ...fields(draft), name: draft.name ?? profile.name, modelId: draft.modelId ?? profile.modelId }
	await change(profiles.value.map(entry => entry.id === profile.id ? edited : entry), async () => {
		const saved = await act<Profile>(`/api/v1/model-profiles/${profile.id}`, { method: 'PATCH', body: fields(draft), success: 'Profile saved' })
		// The server sets the platform from the model.
		if (saved) queryCache.setQueryData(modelProfilesQuery.key, profiles.value.map(entry => entry.id === profile.id ? saved : entry))
		return saved
	})
}

async function remove(profile: Profile) {
	const confirmed = await confirm.open({ title: 'Delete profile', description: `"${profile.name}" will be deleted. Chats started from it keep their settings.`, color: 'error' }).result
	if (confirmed) {
		await change(profiles.value.filter(entry => entry.id !== profile.id), () => act(`/api/v1/model-profiles/${profile.id}`, { method: 'DELETE', success: 'Profile deleted' }))
	}
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
			<PageNavbar>
				<template #right>
					<UButton v-if="canEdit" icon="i-lucide-plus" label="Add model" :loading="adding" :disabled="!platform" @click="quickAdd" />
				</template>
			</PageNavbar>
		</template>

		<template #body>
			<div class="w-full max-w-5xl mx-auto flex flex-col gap-4">
				<p class="text-sm text-muted">
					A profile is a model with its settings and system prompt. Start a chat from one; changes made in a chat stay in that chat.
				</p>
				<UTabs v-model="tab" :items="tabs" :content="false" class="w-full" />

				<div v-if="isPending" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading profiles">
					<USkeleton v-for="n in 3" :key="n" class="h-24 w-full" />
				</div>
				<UEmpty
					v-else-if="!shown.length"
					icon="i-lucide-bot"
					:title="tab === 'mine' ? 'No profiles yet' : 'No instance profiles'"
					:description="tab === 'mine' ? 'Add a model to make your first profile.' : isAdmin ? 'Publish a profile for every member.' : 'An admin can publish profiles for everyone.'"
				/>
				<ul v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					<li v-for="profile in shown" :key="profile.id" class="flex flex-col gap-3 rounded-md border border-default p-4">
						<div class="flex items-center gap-2">
							<span :class="['size-2.5 rounded-full shrink-0', profile.color ? LANE_COLOR_CLASSES[profile.color as keyof typeof LANE_COLOR_CLASSES] : 'bg-(--ui-border-accented)']" />
							<span class="font-medium text-highlighted truncate flex-1">{{ profile.name }}</span>
							<PinButton kind="modelProfile" :target-id="profile.id" />
							<UDropdownMenu :items="actions(profile)" :content="{ align: 'end' }">
								<UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="sm" aria-label="Profile actions" />
							</UDropdownMenu>
						</div>
						<p class="text-sm text-muted truncate">
							{{ modelName(profile) }}
						</p>
						<div class="flex flex-wrap gap-1.5 mt-auto">
							<UBadge v-if="characterName(profile)" :label="`Character: ${characterName(profile)}`" icon="i-lucide-drama" color="neutral" variant="subtle" size="sm" />
							<UBadge v-else-if="profile.systemPrompt" label="Custom system prompt" color="neutral" variant="subtle" size="sm" />
							<UBadge v-if="platform && profile.platform !== platform.id" label="Other platform" color="warning" variant="subtle" size="sm" />
						</div>
					</li>
				</ul>
			</div>
		</template>
	</UDashboardPanel>
</template>
