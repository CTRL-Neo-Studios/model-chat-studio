<script setup lang="ts">
/** Deleting a project: says what goes, and asks whether the owner's own chats in it go too. */
const props = defineProps<{
	projectId: string
	name: string
}>()

/** What happens to the owner's own chats, or nothing when cancelled. */
const emit = defineEmits<{ close: [ownChats?: 'delete' | 'keep'] }>()

const { data: project } = useQuery(() => projectQuery(props.projectId))
const counts = computed(() => project.value?.counts)
const ownChats = ref<'delete' | 'keep'>('keep')
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
</script>

<template>
	<UModal :title="`Delete “${name}”`" :ui="{ footer: 'flex-row-reverse justify-start' }" :close="false" :dismissible="false">
		<template #body>
			<div v-if="counts" class="flex flex-col gap-4 text-sm">
				<p>
					The project and its file space go: {{ plural(counts.entries, 'file, note or folder', 'files, notes and folders') }}.
					<template v-if="counts.otherChats">
						{{ plural(counts.otherChats, 'chat', 'chats') }} by other people stay theirs, as ordinary chats.
					</template>
				</p>
				<URadioGroup
					v-if="counts.ownChats"
					v-model="ownChats"
					:legend="`Your ${plural(counts.ownChats, 'chat', 'chats')} in this project`"
					:items="[
						{ label: 'Keep them as ordinary chats', value: 'keep' },
						{ label: 'Delete them too', value: 'delete' },
					]"
				/>
			</div>
			<USkeleton v-else class="h-16 w-full" />
		</template>
		<template #footer>
			<UButton color="error" label="Delete" :disabled="!counts" @click="emit('close', ownChats)" />
			<UButton color="neutral" variant="ghost" label="Cancel" @click="emit('close')" />
		</template>
	</UModal>
</template>
