<script setup lang="ts">
const route = useRoute()
const libraryId = route.params.id as string
// Rendered by the server with its data, the library and its files together, as members open it from links.
// The server reads through the API with the visitor's cookie, so the page holds no more than the API gives them.
const { data: library, error } = useQuery({ ...libraryQuery(libraryId), enabled: true })
const { data: entries } = useQuery({ ...libraryEntriesQuery(libraryId), enabled: true })
useHead({ title: () => library.value?.name ?? 'Library' })

// The tree is in the sidebar (`SidebarLibrary`); the page shows the entry open there (`?entry=`).
const entry = computed(() => entries.value?.find(item => item.id === route.query.entry))

// What the visitor may do here (the access table, plan section 3); the server checks every change again.
const isOwner = computed(() => library.value?.role === 'owner')
const canEditFiles = computed(() => library.value?.role === 'owner' || library.value?.role === 'editor')
</script>

<template>
	<UDashboardPanel id="library" class="min-h-0" :ui="{ body: 'p-0 sm:p-0' }">
		<template #header>
			<PageNavbar :current="library?.name">
				<template #right>
					<LibraryLorebook v-if="library" :library-id="libraryId" :lorebook="library.lorebook" :can-manage="isOwner" />
					<LibraryPeople v-if="library" :library-id="libraryId" :can-manage="isOwner" />
				</template>
			</PageNavbar>
		</template>

		<template #body>
			<UError v-if="error" :error="{ statusMessage: 'Library not found', statusCode: 404 }" class="min-h-full" />
			<div v-else class="flex-1 min-w-0 overflow-y-auto">
				<LibraryEntry v-if="entry" :key="entry.id" :library-id="libraryId" :entry="entry" :readonly="!canEditFiles" />
				<UEmpty v-else icon="i-lucide-mouse-pointer-click" title="Nothing open" description="Pick a file or a note in the sidebar to see it here." class="h-full" />
			</div>
		</template>
	</UDashboardPanel>
</template>
