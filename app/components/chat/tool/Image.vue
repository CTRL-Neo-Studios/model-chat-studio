<script setup lang="ts">
/** An image the model drew (`generate_image`): "Drawing…", then the image with Download and "Add to library". */
const props = defineProps<{
	invocation: {
		state: string
		input?: { prompt?: string }
		output?: { fileId: string, url: string, mediaType: string, prompt: string }
		errorText?: string
	}
}>()

const prompt = computed(() => props.invocation.output?.prompt ?? props.invocation.input?.prompt ?? '')

// "Add to library": a copy goes to the top of one of the chat's libraries the reader may change.
const libraries = inject(chatLibrariesKey, computed(() => []))
const act = useApiAction()
const queryCache = useQueryCache()
const adding = ref(false)
async function addToLibrary(libraryId: string) {
	const fileId = props.invocation.output?.fileId
	if (!fileId) return
	adding.value = true
	const added = await act(`/api/v1/libraries/${libraryId}/files/from-chat`, { method: 'POST', body: { fileId }, success: 'Added to the library' })
	adding.value = false
	if (added) queryCache.invalidateQueries({ key: libraryEntriesQuery(libraryId).key })
}
</script>

<template>
	<div class="my-2 flex flex-col gap-2 max-w-md">
		<UAlert
			v-if="invocation.state === 'output-error'"
			title="The image could not be drawn"
			:description="invocation.errorText"
			icon="i-lucide-image-off"
			color="error"
			variant="subtle"
		/>
		<template v-else-if="invocation.state === 'output-available' && invocation.output">
			<a :href="invocation.output.url" target="_blank" rel="noopener" class="block">
				<img :src="invocation.output.url" :alt="prompt" class="w-full rounded-md border border-default bg-muted">
			</a>
			<div class="flex flex-wrap items-center gap-1">
				<UButton :to="invocation.output.url" :download="`image.${invocation.output.mediaType.split('/')[1] ?? 'png'}`" external icon="i-lucide-download" label="Download" size="xs" color="neutral" variant="subtle" />
				<UButton
					v-if="libraries.length === 1"
					icon="i-lucide-library-big"
					label="Add to library"
					size="xs"
					color="neutral"
					variant="subtle"
					:loading="adding"
					@click="addToLibrary(libraries[0]!.id)"
				/>
				<UDropdownMenu
					v-else-if="libraries.length > 1"
					:items="libraries.map(library => ({ label: library.name, icon: 'i-lucide-library-big', onSelect: () => addToLibrary(library.id) }))"
				>
					<UButton icon="i-lucide-library-big" label="Add to library" trailing-icon="i-lucide-chevron-down" size="xs" color="neutral" variant="subtle" :loading="adding" />
				</UDropdownMenu>
			</div>
		</template>
		<div v-else class="flex items-center gap-2 text-sm text-muted">
			<UIcon name="i-lucide-loader-circle" class="size-4 animate-spin shrink-0" />
			<span class="truncate">Drawing{{ prompt ? `: ${prompt}` : '…' }}</span>
		</div>
	</div>
</template>
