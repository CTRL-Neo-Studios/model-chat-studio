<script setup lang="ts">
/** Deleting a library: says what goes, and how many of the owner's chats lose it. */
const props = defineProps<{
	libraryId: string
	name: string
}>()

/** `true` to delete, nothing when cancelled. */
const emit = defineEmits<{ close: [confirmed?: true] }>()

const { data: library } = useQuery(() => libraryQuery(props.libraryId))
const counts = computed(() => library.value?.counts)
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
</script>

<template>
	<UModal :title="`Delete “${name}”`" :ui="{ footer: 'flex-row-reverse justify-start' }" :close="false" :dismissible="false">
		<template #body>
			<p v-if="counts" class="text-sm">
				The library and its {{ plural(counts.entries, 'file, note or folder', 'files, notes and folders') }} go.
				<template v-if="counts.ownChats">
					{{ plural(counts.ownChats, 'chat', 'chats') }} of yours use it; they stay, without it.
				</template>
				Other people's chats lose it too.
			</p>
			<USkeleton v-else class="h-16 w-full" />
		</template>
		<template #footer>
			<UButton color="error" label="Delete" :disabled="!counts" @click="emit('close', true)" />
			<UButton color="neutral" variant="ghost" label="Cancel" @click="emit('close')" />
		</template>
	</UModal>
</template>
