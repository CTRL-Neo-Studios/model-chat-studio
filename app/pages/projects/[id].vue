<script setup lang="ts">
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
					<UTabs v-if="project" v-model="tab" :items="tabs" :content="false" size="sm" />
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<UError v-if="error" :error="{ statusMessage: 'Project not found', statusCode: 404 }" class="min-h-full" />
			<template v-else-if="project">
				<div v-if="tab === 'chats'" class="w-full max-w-2xl mx-auto flex flex-col gap-4 p-4 sm:p-6">
					<UButton icon="i-lucide-circle-plus" label="New chat in this project" :to="{ path: '/', query: { project: projectId } }" class="self-start" />
					<UEmpty v-if="!chats.length" icon="i-lucide-messages-square" title="No chats yet" description="Chats started here can name the project's files and notes with “@”." />
					<SidebarChats :chats="chats" :project-id="projectId" />
				</div>
				<ProjectFiles v-else v-model:selected="selected" :project-id="projectId" />
			</template>
			<div v-else class="flex flex-col gap-2 p-4 w-72" aria-busy="true" aria-label="Loading the project">
				<USkeleton v-for="n in 5" :key="n" class="h-7 w-full" />
			</div>
		</template>
	</UDashboardPanel>
</template>
