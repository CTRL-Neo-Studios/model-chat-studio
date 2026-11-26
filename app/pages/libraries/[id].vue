<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const libraryId = route.params.id as string
// Rendered by the server with its data, the library and its files together, as members open it from links.
// The server reads through the API with the visitor's cookie, so the page holds no more than the API gives them.
const { data: library, error } = useQuery({ ...libraryQuery(libraryId), enabled: true })
useQuery({ ...libraryEntriesQuery(libraryId), enabled: true })
useHead({ title: () => library.value?.name ?? 'Library' })

// The open entry is in the address, so a reload or a shared link opens it again.
const selected = computed({
	get: () => typeof route.query.entry === 'string' ? route.query.entry : undefined,
	set: entry => router.replace({ query: { ...route.query, entry } }),
})

// What the visitor may do here (the access table, plan section 3); the server checks every change again.
const isOwner = computed(() => library.value?.role === 'owner')
const canEditFiles = computed(() => library.value?.role === 'owner' || library.value?.role === 'editor')
</script>

<template>
	<UDashboardPanel id="library" class="min-h-0" :ui="{ body: 'p-0 sm:p-0' }">
		<template #header>
			<UDashboardNavbar :title="library?.name ?? ''">
				<template #leading>
					<UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" to="/libraries" aria-label="All libraries" />
				</template>
				<template #right>
					<LibraryLorebook v-if="library" :library-id="libraryId" :lorebook="library.lorebook" :can-manage="isOwner" />
					<LibraryPeople v-if="library" :library-id="libraryId" :can-manage="isOwner" />
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<UError v-if="error" :error="{ statusMessage: 'Library not found', statusCode: 404 }" class="min-h-full" />
			<LibraryFiles v-else-if="library" v-model:selected="selected" :library-id="libraryId" :readonly="!canEditFiles" />
			<div v-else class="flex flex-col gap-2 p-4 w-72" aria-busy="true" aria-label="Loading the library">
				<USkeleton v-for="n in 5" :key="n" class="h-7 w-full" />
			</div>
		</template>
	</UDashboardPanel>
</template>
