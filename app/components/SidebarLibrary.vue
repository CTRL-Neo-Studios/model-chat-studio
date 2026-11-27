<script setup lang="ts">
/** Inside a library: back to the list, its name, and its files as a tree; the page shows the one open. */
defineProps<{ collapsed?: boolean }>()

const route = useRoute()
const libraryId = computed(() => route.params.id as string)
const { data: library } = useQuery(() => libraryQuery(libraryId.value))
// Viewers read the library; owners and editors change its files. The server checks every change again.
const readonly = computed(() => library.value?.role !== 'owner' && library.value?.role !== 'editor')
</script>

<template>
	<UNavigationMenu :items="[[{ label: 'Libraries', icon: 'i-lucide-arrow-left', to: '/content/libraries' }], [{ label: library?.name ?? '', type: 'label' }]]" :collapsed="collapsed" orientation="vertical" />
	<LibraryTree v-if="library && !collapsed" :key="libraryId" :library-id="libraryId" :readonly="readonly" />
</template>
