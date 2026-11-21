<script setup lang="ts">
/** The keyboard twin of dragging in the sidebar: pick the folder to move a chat or folder into. */
const props = defineProps<{
	/** What moves, for the title. */
	name: string
	/** Folders it may move into, with their path as the label. */
	folders: { id: string, label: string }[]
	/** Where it is now; `null` is no folder. */
	current: string | null
}>()

/** The chosen folder, `null` for no folder, nothing when cancelled. */
const emit = defineEmits<{ close: [folderId?: string | null] }>()

const ROOT = 'root'
const choice = ref(props.current ?? ROOT)
const items = computed(() => [{ label: 'No folder', value: ROOT }, ...props.folders.map(folder => ({ label: folder.label, value: folder.id }))])
</script>

<template>
	<UModal :title="`Move “${name}”`" :ui="{ footer: 'flex-row-reverse justify-start' }" :close="false">
		<template #body>
			<URadioGroup v-model="choice" :items="items" class="max-h-80 overflow-y-auto" />
		</template>

		<template #footer>
			<UButton label="Move" :disabled="choice === (current ?? ROOT)" @click="emit('close', choice === ROOT ? null : choice)" />
			<UButton color="neutral" variant="ghost" label="Cancel" @click="emit('close')" />
		</template>
	</UModal>
</template>
