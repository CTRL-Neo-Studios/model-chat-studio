<script setup lang="ts">
import { LazyContextProfileEditor } from '#components'

const route = useRoute()
const router = useRouter()
const projectId = route.params.id as string
const { data: project, error } = useQuery(projectQuery(projectId))
useHead({ title: () => project.value?.name ?? 'Project' })

// The tab and the open entry are in the address, so a reload or a shared link opens them again.
const tab = computed({
	get: () => route.query.tab === 'files' ? 'files' : 'chats',
	set: value => router.replace({ query: { ...route.query, tab: value === 'chats' ? undefined : value } }),
})
const tabs = [
	{ label: 'Chats', value: 'chats', icon: 'i-lucide-messages-square' },
	{ label: 'Files', value: 'files', icon: 'i-lucide-folder-tree' },
]
const selected = computed({
	get: () => typeof route.query.entry === 'string' ? route.query.entry : undefined,
	set: entry => router.replace({ query: { ...route.query, entry } }),
})

const { data: chatList } = useQuery(chatsQuery)
const chats = computed(() => (chatList.value ?? []).filter(chat => chat.projectId === projectId).map(toUIChat))

// The project's default context profile; editing it from here offers this project's paths for its files blocks.
const act = useApiAction()
const queryCache = useQueryCache()
const { user } = useUserSession()
const isAdmin = computed(() => user.value?.role === 'admin')
const { data: profileList } = useQuery(contextProfilesQuery)
const NONE = 'none'
const profileItems = computed(() => [
	{ label: 'None', value: NONE },
	...(profileList.value ?? []).map(profile => ({ label: profile.ownerId === null ? `${profile.name} (instance)` : profile.name, value: profile.id })),
])
const defaultProfile = computed(() => profileList.value?.find(profile => profile.id === project.value?.contextProfileId))
const profileChoice = computed({
	get: () => project.value?.contextProfileId ?? NONE,
	set: async (value: string) => {
		const before = project.value
		if (!before) return
		const contextProfileId = value === NONE ? null : value
		queryCache.setQueryData(projectQuery(projectId).key, { ...before, contextProfileId })
		if (!await act(`/api/v1/projects/${projectId}`, { method: 'PATCH', body: { contextProfileId } })) queryCache.setQueryData(projectQuery(projectId).key, before)
	},
})
const editor = useOverlay().create(LazyContextProfileEditor)
async function editDefault() {
	const profile = defaultProfile.value
	if (!profile) return
	const draft = await editor.open({ title: 'Edit context profile', profile: { name: profile.name, blocks: profile.blocks }, projectId }).result
	if (!draft) return
	const saved = await act<typeof profile>(`/api/v1/context-profiles/${profile.id}`, { method: 'PATCH', body: { ...draft }, success: 'Profile saved' })
	if (saved) queryCache.setQueryData(contextProfilesQuery.key, (profileList.value ?? []).map(entry => entry.id === saved.id ? saved : entry))
}

// What the visitor may do here (the access table, plan section 5); the server checks every change again.
const isProjectOwner = computed(() => project.value?.role === 'owner')
const canStartChats = computed(() => project.value?.role !== 'viewer')
const canEditFiles = computed(() => project.value?.role === 'owner' || project.value?.role === 'editor')
const { data: sharedChatList } = useQuery(() => projectChatsQuery(projectId))
const sharedChats = computed(() => sharedChatList.value ?? [])
</script>

<template>
	<UDashboardPanel id="project" class="min-h-0" :ui="{ body: 'p-0 sm:p-0' }">
		<template #header>
			<UDashboardNavbar :title="project?.name ?? ''">
				<template #leading>
					<UDashboardSidebarCollapse />
					<UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" to="/projects" aria-label="All projects" />
				</template>
				<template #right>
					<ProjectPeople v-if="project" :project-id="projectId" :can-manage="isProjectOwner" />
					<UTabs v-if="project" v-model="tab" :items="tabs" :content="false" size="sm" />
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<UError v-if="error" :error="{ statusMessage: 'Project not found', statusCode: 404 }" class="min-h-full" />
			<template v-else-if="project">
				<div v-if="tab === 'chats'" class="w-full max-w-2xl mx-auto flex flex-col gap-4 p-4 sm:p-6">
					<div class="flex flex-wrap items-end gap-3">
						<UButton v-if="canStartChats" icon="i-lucide-circle-plus" label="New chat in this project" :to="{ path: '/', query: { project: projectId } }" />
						<UFormField v-if="isProjectOwner" label="Context profile" help="Used by the project's chats unless one picks its own." class="ms-auto min-w-56">
							<div class="flex items-center gap-1">
								<USelect v-model="profileChoice" :items="profileItems" size="sm" class="flex-1" />
								<UTooltip v-if="defaultProfile && (defaultProfile.ownerId !== null || isAdmin)" text="Edit this profile">
									<UButton icon="i-lucide-pencil" color="neutral" variant="ghost" size="sm" aria-label="Edit the context profile" @click="editDefault" />
								</UTooltip>
							</div>
						</UFormField>
						<p v-else-if="project.contextProfileName" class="ms-auto text-sm text-muted">
							Context profile: {{ project.contextProfileName }}
						</p>
					</div>
					<template v-if="canStartChats">
						<UEmpty v-if="!chats.length" icon="i-lucide-messages-square" title="No chats yet" description="Chats started here can name the project's files and notes with “@”." />
						<SidebarChats :chats="chats" :project-id="projectId" />
					</template>
					<!-- Other people's chats that they made visible to the project: read only. -->
					<section v-if="sharedChats.length" class="flex flex-col gap-1">
						<h2 class="ps-2.5 text-xs font-semibold text-highlighted">
							Shared in this project
						</h2>
						<NuxtLink
							v-for="chat in sharedChats"
							:key="chat.id"
							:to="`/chat/${chat.id}`"
							class="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm hover:bg-elevated/50"
						>
							<span class="truncate flex-1" :class="!chat.title && 'text-muted'">{{ chat.title || 'Untitled' }}</span>
							<span class="text-xs text-muted shrink-0">{{ chat.author.name || chat.author.username }}</span>
						</NuxtLink>
					</section>
					<UEmpty v-else-if="!canStartChats" icon="i-lucide-messages-square" title="No shared chats yet" description="Chats appear here when their authors make them visible to the project." />
				</div>
				<ProjectFiles v-else v-model:selected="selected" :project-id="projectId" :readonly="!canEditFiles" />
			</template>
			<div v-else class="flex flex-col gap-2 p-4 w-72" aria-busy="true" aria-label="Loading the project">
				<USkeleton v-for="n in 5" :key="n" class="h-7 w-full" />
			</div>
		</template>
	</UDashboardPanel>
</template>
