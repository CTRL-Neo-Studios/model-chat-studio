<script setup lang="ts">
import type { EditorToolbarItem } from '@nuxt/ui'
import { FILE_UPLOAD } from '#shared/utils/file'

/** The open entry of a project's file space: a note to edit, a file to preview, a folder; each with its tags. */
const props = defineProps<{
	projectId: string
	entry: { id: string, kind: 'folder' | 'file' | 'note', name: string, tags: string[], fileId: string | null, mediaType: string | null, size: number | null }
	/** Viewers and members: read, not changed. */
	readonly?: boolean
}>()

const act = useApiAction()
const queryCache = useQueryCache()
const entriesKey = computed(() => projectEntriesQuery(props.projectId).key)
const url = computed(() => `/api/v1/projects/${props.projectId}/entries/${props.entry.id}`)

// Tags save on each change; the tree's copy changes with them and comes back if the server refuses.
async function saveTags(tags: string[]) {
	const before = queryCache.getQueryData(entriesKey.value)
	queryCache.setQueryData(entriesKey.value, list => list?.map(item => item.id === props.entry.id ? { ...item, tags } : item) ?? [])
	if (!await act(url.value, { method: 'PATCH', body: { tags } }) && before) queryCache.setQueryData(entriesKey.value, before)
}

// A note's text, saved a moment after typing stops, and at once when another entry opens.
const { data: full } = useQuery(() => ({ ...projectEntryQuery({ projectId: props.projectId, entryId: props.entry.id }), enabled: props.entry.kind === 'note' }))
const text = ref<string>()
let saved: string | undefined
watch(full, (value) => {
	if (value && text.value === undefined) text.value = saved = value.content ?? ''
}, { immediate: true })

const saving = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
async function save() {
	timer = undefined
	const content = text.value
	if (content === undefined || content === saved) return
	saving.value = true
	const done = await act(url.value, { method: 'PATCH', body: { content } })
	saving.value = false
	if (!done) return
	saved = content
	const key = projectEntryQuery({ projectId: props.projectId, entryId: props.entry.id }).key
	const cached = queryCache.getQueryData(key)
	if (cached) queryCache.setQueryData(key, { ...cached, content })
}
watch(text, () => {
	clearTimeout(timer)
	timer = setTimeout(save, 800)
})
onBeforeUnmount(() => {
	if (timer) {
		clearTimeout(timer)
		save()
	}
})
const unsaved = computed(() => saving.value || (text.value !== undefined && text.value !== saved))

const toolbar: EditorToolbarItem[][] = [[
	{ kind: 'undo', icon: 'i-lucide-undo', tooltip: { text: 'Undo' } },
	{ kind: 'redo', icon: 'i-lucide-redo', tooltip: { text: 'Redo' } },
], [
	{ icon: 'i-lucide-heading', tooltip: { text: 'Headings' }, content: { align: 'start' }, items: [
		{ kind: 'heading', level: 1, icon: 'i-lucide-heading-1', label: 'Heading 1' },
		{ kind: 'heading', level: 2, icon: 'i-lucide-heading-2', label: 'Heading 2' },
		{ kind: 'heading', level: 3, icon: 'i-lucide-heading-3', label: 'Heading 3' },
	] },
	{ kind: 'bulletList', icon: 'i-lucide-list', tooltip: { text: 'Bullet list' } },
	{ kind: 'orderedList', icon: 'i-lucide-list-ordered', tooltip: { text: 'Numbered list' } },
	{ kind: 'blockquote', icon: 'i-lucide-text-quote', tooltip: { text: 'Quote' } },
	{ kind: 'codeBlock', icon: 'i-lucide-square-code', tooltip: { text: 'Code block' } },
], [
	{ kind: 'mark', mark: 'bold', icon: 'i-lucide-bold', tooltip: { text: 'Bold' } },
	{ kind: 'mark', mark: 'italic', icon: 'i-lucide-italic', tooltip: { text: 'Italic' } },
	{ kind: 'mark', mark: 'strike', icon: 'i-lucide-strikethrough', tooltip: { text: 'Strikethrough' } },
	{ kind: 'mark', mark: 'code', icon: 'i-lucide-code', tooltip: { text: 'Code' } },
	{ kind: 'link', icon: 'i-lucide-link', tooltip: { text: 'Link' } },
]]

const fileUrl = computed(() => props.entry.fileId ? `/api/v1/files/${props.entry.fileId}` : '')
const isImage = computed(() => (FILE_UPLOAD.imageTypes as readonly string[]).includes(props.entry.mediaType ?? ''))
const isPdf = computed(() => props.entry.mediaType === FILE_UPLOAD.pdfType)
const size = computed(() => {
	const bytes = props.entry.size ?? 0
	return bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} kB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`
})
</script>

<template>
	<div class="flex flex-col min-h-full">
		<div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-6 py-3 border-b border-default">
			<h2 class="font-semibold text-highlighted truncate">
				{{ entry.name }}
			</h2>
			<span v-if="entry.kind === 'note' && !readonly" class="text-xs text-muted">{{ unsaved ? 'Saving…' : 'Saved' }}</span>
			<span v-else-if="entry.kind === 'file'" class="text-xs text-muted">{{ size }}</span>
			<UInputTags
				:model-value="entry.tags"
				placeholder="Add tags"
				:max="20"
				:max-length="50"
				add-on-blur
				add-on-paste
				delimiter=","
				size="sm"
				variant="subtle"
				icon="i-lucide-tag"
				aria-label="Tags"
				:disabled="readonly"
				class="ms-auto min-w-56"
				@update:model-value="saveTags"
			/>
		</div>

		<template v-if="entry.kind === 'note'">
			<UEditor
				v-if="text !== undefined"
				v-slot="{ editor }"
				v-model="text"
				content-type="markdown"
				:editable="!readonly"
				placeholder="Write the note…"
				:ui="{ base: 'px-6 py-4 min-h-80' }"
				class="w-full"
			>
				<UEditorToolbar v-if="!readonly" :editor="editor" :items="toolbar" class="border-b border-muted px-4 py-1.5 sticky top-0 z-10 bg-default overflow-x-auto" />
			</UEditor>
			<div v-else class="flex flex-col gap-2 p-6" aria-busy="true" aria-label="Loading the note">
				<USkeleton v-for="n in 4" :key="n" class="h-5 w-full" />
			</div>
		</template>

		<div v-else-if="entry.kind === 'file'" class="flex-1 flex flex-col gap-3 p-6">
			<img v-if="isImage" :src="fileUrl" :alt="entry.name" class="max-w-full max-h-[70vh] object-contain self-start rounded-md border border-default">
			<iframe v-else-if="isPdf" :src="fileUrl" :title="entry.name" class="w-full flex-1 min-h-[70vh] rounded-md border border-default" />
			<UButton :to="fileUrl" target="_blank" external icon="i-lucide-download" :label="isImage || isPdf ? 'Open in a new tab' : 'Download'" color="neutral" variant="subtle" class="self-start" />
		</div>

		<UEmpty v-else icon="i-lucide-folder" title="Folder" description="Drag files onto it, or use its menu in the tree to add notes and uploads." class="flex-1" />
	</div>
</template>
