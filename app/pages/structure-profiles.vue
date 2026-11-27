<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { PROFILE_TEMPLATES, type ProfileBlock } from '#shared/utils/structureProfile'
import { LazyModalConfirm, LazyStructureProfileEditor } from '#components'

useHead({ title: 'Structure profiles' })

const act = useApiAction()
const overlay = useOverlay()
const { user } = useUserSession()
const queryCache = useQueryCache()
const { pinnedFirst } = usePins()
const { data, isPending } = useQuery(structureProfilesQuery)
const profiles = computed(() => data.value ?? [])
type Profile = (typeof profiles.value)[number]

const isAdmin = computed(() => user.value?.role === 'admin')
const tab = ref<'mine' | 'instance'>('mine')
const tabs = [
	{ label: 'Mine', value: 'mine', icon: 'i-lucide-user' },
	{ label: 'Instance', value: 'instance', icon: 'i-lucide-building' },
]
const shown = computed(() => pinnedFirst('structureProfile', profiles.value.filter(profile => (profile.ownerId === null) === (tab.value === 'instance'))))
const canEdit = computed(() => tab.value === 'mine' || isAdmin.value)

const editor = overlay.create(LazyStructureProfileEditor)
const confirm = overlay.create(LazyModalConfirm)
const { publishActions } = useListingActions()

async function create(template: (typeof PROFILE_TEMPLATES)[number]) {
	const blocks = template.blocks.map(block => ({ ...block, id: crypto.randomUUID() }) as ProfileBlock)
	const draft = await editor.open({ title: 'New structure profile', profile: { name: template.name, blocks } }).result
	if (!draft) return
	const profile = await act<Profile>('/api/v1/structure-profiles', { method: 'POST', body: { ...draft, instance: tab.value === 'instance' || undefined }, success: 'Profile added' })
	if (profile) queryCache.setQueryData(structureProfilesQuery.key, [...profiles.value, profile])
}
const newItems = computed<DropdownMenuItem[]>(() => PROFILE_TEMPLATES.map(template => ({ label: template.label, onSelect: () => create(template) })))

async function edit(profile: Profile) {
	const draft = await editor.open({ title: 'Edit structure profile', profile: { name: profile.name, blocks: profile.blocks } }).result
	if (!draft) return
	const saved = await act<Profile>(`/api/v1/structure-profiles/${profile.id}`, { method: 'PATCH', body: { ...draft }, success: 'Profile saved' })
	if (saved) queryCache.setQueryData(structureProfilesQuery.key, profiles.value.map(entry => entry.id === profile.id ? saved : entry))
}

async function copy(profile: Profile, instance: boolean) {
	const blocks = profile.blocks.map(block => ({ ...block, id: crypto.randomUUID() }))
	const saved = await act<Profile>('/api/v1/structure-profiles', { method: 'POST', body: { name: profile.name, blocks, instance: instance || undefined }, success: instance ? 'Published for everyone' : 'Copied to your profiles' })
	if (saved) queryCache.setQueryData(structureProfilesQuery.key, [...profiles.value, saved])
}

async function remove(profile: Profile) {
	const confirmed = await confirm.open({ title: 'Delete structure profile', description: `“${profile.name}” will be deleted. Chats using it go back to none.`, color: 'error' }).result
	if (!confirmed) return
	const before = profiles.value
	queryCache.setQueryData(structureProfilesQuery.key, before.filter(entry => entry.id !== profile.id))
	if (!await act(`/api/v1/structure-profiles/${profile.id}`, { method: 'DELETE', success: 'Profile deleted' })) queryCache.setQueryData(structureProfilesQuery.key, before)
}

function actions(profile: Profile): DropdownMenuItem[][] {
	const mine = profile.ownerId !== null
	return [[
		...(canEdit.value ? [{ label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => edit(profile) }] : []),
		...(mine
			? isAdmin.value ? [{ label: 'Publish for everyone', icon: 'i-lucide-share', onSelect: () => copy(profile, true) }] : []
			: [{ label: 'Copy to my profiles', icon: 'i-lucide-copy', onSelect: () => copy(profile, false) }]),
	], ...(mine ? [publishActions({ structureProfileIds: [profile.id] }, profile.name)] : []), ...(canEdit.value ? [[{ label: 'Delete', icon: 'i-lucide-trash', color: 'error' as const, onSelect: () => remove(profile) }]] : [])]
}

const kindLabel: Record<ProfileBlock['kind'], string> = { message: 'message', history: 'conversation', autoFetch: 'auto-fetch', files: 'files', userCharacter: 'your Character', participants: 'participants' }
const summary = (blocks: ProfileBlock[]) => blocks.map(block => block.kind === 'message' ? `${block.role} ${kindLabel.message}` : kindLabel[block.kind]).join(' → ')
</script>

<template>
	<UDashboardPanel id="structure-profiles" class="min-h-0">
		<template #header>
			<UDashboardNavbar title="Structure profiles">
				<template #right>
					<UDropdownMenu v-if="canEdit" :items="newItems" :content="{ align: 'end' }">
						<UButton icon="i-lucide-plus" label="New profile" trailing-icon="i-lucide-chevron-down" />
					</UDropdownMenu>
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<div class="w-full max-w-5xl mx-auto flex flex-col gap-4">
				<p class="text-sm text-muted">
					A structure profile arranges what a chat sends: messages of your own around the conversation, library files, and where auto-fetched files go. Pick one for a chat in its library settings.
				</p>
				<UTabs v-model="tab" :items="tabs" :content="false" class="w-full" />

				<div v-if="isPending" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading profiles">
					<USkeleton v-for="n in 3" :key="n" class="h-24 w-full" />
				</div>
				<UEmpty
					v-else-if="!shown.length"
					icon="i-lucide-layers"
					:title="tab === 'mine' ? 'No structure profiles yet' : 'No instance profiles'"
					:description="tab === 'mine' ? 'Start from a blank profile or one of the examples.' : isAdmin ? 'Publish a profile for every member.' : 'An admin can publish profiles for everyone.'"
				/>
				<ul v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					<li v-for="profile in shown" :key="profile.id" class="flex flex-col gap-2 rounded-md border border-default p-4">
						<div class="flex items-center gap-2">
							<UIcon name="i-lucide-layers" class="size-5 text-muted shrink-0" />
							<span class="font-medium text-highlighted truncate flex-1">{{ profile.name }}</span>
							<PublishedBadge v-if="profile.ownerId !== null" :source="{ structureProfileIds: [profile.id] }" />
							<PinButton kind="structureProfile" :target-id="profile.id" />
							<UDropdownMenu :items="actions(profile)" :content="{ align: 'end' }">
								<UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="sm" aria-label="Profile actions" />
							</UDropdownMenu>
						</div>
						<p class="text-sm text-muted line-clamp-3">
							{{ summary(profile.blocks) }}
						</p>
					</li>
				</ul>
			</div>
		</template>
	</UDashboardPanel>
</template>
