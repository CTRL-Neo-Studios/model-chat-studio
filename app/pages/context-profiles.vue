<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { PROFILE_TEMPLATES, type ProfileBlock } from '#shared/utils/contextProfile'
import { LazyContextProfileEditor, LazyModalConfirm } from '#components'

useHead({ title: 'Context profiles' })

const act = useApiAction()
const overlay = useOverlay()
const { user } = useUserSession()
const queryCache = useQueryCache()
const { pinnedFirst } = usePins()
const { data, isPending } = useQuery(contextProfilesQuery)
const profiles = computed(() => data.value ?? [])
type Profile = (typeof profiles.value)[number]

const isAdmin = computed(() => user.value?.role === 'admin')
const tab = ref<'mine' | 'instance'>('mine')
const tabs = [
	{ label: 'Mine', value: 'mine', icon: 'i-lucide-user' },
	{ label: 'Instance', value: 'instance', icon: 'i-lucide-building' },
]
const shown = computed(() => pinnedFirst('contextProfile', profiles.value.filter(profile => (profile.ownerId === null) === (tab.value === 'instance'))))
const canEdit = computed(() => tab.value === 'mine' || isAdmin.value)

const editor = overlay.create(LazyContextProfileEditor)
const confirm = overlay.create(LazyModalConfirm)

async function create(template: (typeof PROFILE_TEMPLATES)[number]) {
	const blocks = template.blocks.map(block => ({ ...block, id: crypto.randomUUID() }) as ProfileBlock)
	const draft = await editor.open({ title: 'New context profile', profile: { name: template.name, blocks } }).result
	if (!draft) return
	const profile = await act<Profile>('/api/v1/context-profiles', { method: 'POST', body: { ...draft, instance: tab.value === 'instance' || undefined }, success: 'Profile added' })
	if (profile) queryCache.setQueryData(contextProfilesQuery.key, [...profiles.value, profile])
}
const newItems = computed<DropdownMenuItem[]>(() => PROFILE_TEMPLATES.map(template => ({ label: template.label, onSelect: () => create(template) })))

async function edit(profile: Profile) {
	const draft = await editor.open({ title: 'Edit context profile', profile: { name: profile.name, blocks: profile.blocks } }).result
	if (!draft) return
	const saved = await act<Profile>(`/api/v1/context-profiles/${profile.id}`, { method: 'PATCH', body: { ...draft }, success: 'Profile saved' })
	if (saved) queryCache.setQueryData(contextProfilesQuery.key, profiles.value.map(entry => entry.id === profile.id ? saved : entry))
}

async function copy(profile: Profile, instance: boolean) {
	const blocks = profile.blocks.map(block => ({ ...block, id: crypto.randomUUID() }))
	const saved = await act<Profile>('/api/v1/context-profiles', { method: 'POST', body: { name: profile.name, blocks, instance: instance || undefined }, success: instance ? 'Published for everyone' : 'Copied to your profiles' })
	if (saved) queryCache.setQueryData(contextProfilesQuery.key, [...profiles.value, saved])
}

async function remove(profile: Profile) {
	const confirmed = await confirm.open({ title: 'Delete context profile', description: `“${profile.name}” will be deleted. Projects and chats using it go back to none.`, color: 'error' }).result
	if (!confirmed) return
	const before = profiles.value
	queryCache.setQueryData(contextProfilesQuery.key, before.filter(entry => entry.id !== profile.id))
	if (!await act(`/api/v1/context-profiles/${profile.id}`, { method: 'DELETE', success: 'Profile deleted' })) queryCache.setQueryData(contextProfilesQuery.key, before)
}

function actions(profile: Profile): DropdownMenuItem[][] {
	const mine = profile.ownerId !== null
	return [[
		...(canEdit.value ? [{ label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => edit(profile) }] : []),
		...(mine
			? (isAdmin.value ? [{ label: 'Publish for everyone', icon: 'i-lucide-share', onSelect: () => copy(profile, true) }] : [])
			: [{ label: 'Copy to my profiles', icon: 'i-lucide-copy', onSelect: () => copy(profile, false) }]),
	], ...(canEdit.value ? [[{ label: 'Delete', icon: 'i-lucide-trash', color: 'error' as const, onSelect: () => remove(profile) }]] : [])]
}

const kindLabel: Record<ProfileBlock['kind'], string> = { message: 'message', history: 'conversation', autoFetch: 'auto-fetch', files: 'files' }
const summary = (blocks: ProfileBlock[]) => blocks.map(block => block.kind === 'message' ? `${block.role} ${kindLabel.message}` : kindLabel[block.kind]).join(' → ')
</script>

<template>
	<UDashboardPanel id="context-profiles" class="min-h-0">
		<template #header>
			<UDashboardNavbar title="Context profiles">
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
					A context profile arranges what a project chat sends: messages of your own around the conversation, project files, and where auto-fetched files go. Pick one for a project, or for a single chat.
				</p>
				<UTabs v-model="tab" :items="tabs" :content="false" class="w-full" />

				<div v-if="isPending" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading profiles">
					<USkeleton v-for="n in 3" :key="n" class="h-24 w-full" />
				</div>
				<UEmpty
					v-else-if="!shown.length"
					icon="i-lucide-layers"
					:title="tab === 'mine' ? 'No context profiles yet' : 'No instance profiles'"
					:description="tab === 'mine' ? 'Start from a blank profile or one of the examples.' : isAdmin ? 'Publish a profile for every member.' : 'An admin can publish profiles for everyone.'"
				/>
				<ul v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					<li v-for="profile in shown" :key="profile.id" class="flex flex-col gap-2 rounded-md border border-default p-4">
						<div class="flex items-center gap-2">
							<UIcon name="i-lucide-layers" class="size-5 text-muted shrink-0" />
							<span class="font-medium text-highlighted truncate flex-1">{{ profile.name }}</span>
							<PinButton kind="contextProfile" :target-id="profile.id" />
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
