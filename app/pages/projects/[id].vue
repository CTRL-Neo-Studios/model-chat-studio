<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const projectId = route.params.id as string
const { data: project, error } = useQuery(projectQuery(projectId))
useHead({ title: () => project.value?.name ?? 'Project' })

// The open entry is in the address, so a reload or a shared link opens it again.
const selected = computed({
	get: () => typeof route.query.entry === 'string' ? route.query.entry : undefined,
	set: entry => router.replace({ query: { ...route.query, entry } }),
})
</script>

<template>
	<UDashboardPanel id="project" class="min-h-0" :ui="{ body: 'p-0 sm:p-0' }">
		<template #header>
			<UDashboardNavbar :title="project?.name ?? ''">
				<template #leading>
					<UDashboardSidebarCollapse />
					<UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" to="/projects" aria-label="All projects" />
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<UError v-if="error" :error="{ statusMessage: 'Project not found', statusCode: 404 }" class="min-h-full" />
			<ProjectFiles v-else-if="project" v-model:selected="selected" :project-id="projectId" />
			<div v-else class="flex flex-col gap-2 p-4 w-72" aria-busy="true" aria-label="Loading the project">
				<USkeleton v-for="n in 5" :key="n" class="h-7 w-full" />
			</div>
		</template>
	</UDashboardPanel>
</template>
