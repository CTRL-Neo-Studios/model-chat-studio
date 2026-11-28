<script setup lang="ts">
import type { EditorToolbarItem } from '@nuxt/ui'
import { FILE_UPLOAD } from '#shared/utils/file'
import type { Lore } from '#shared/utils/lorebook'

/** The open entry of a library: a note to edit, a file to preview, a folder; each with its tags. */
const props = defineProps<{
	libraryId: string
	entry: { id: string, kind: 'folder' | 'file' | 'note', name: string, tags: string[], fileId: string | null, mediaType: string | null, size: number | null }
	/** Viewers: read, not changed. */
	readonly?: boolean
}>()

const act = useApiAction()
const queryCache = useQueryCache()
const entriesKey = computed(() => libraryEntriesQuery(props.libraryId).key)
const url = computed(() => `/api/v1/libraries/${props.libraryId}/entries/${props.entry.id}`)

// Tags save on each change; the tree's copy changes with them and comes back if the server refuses.
async function saveTags(tags: string[]) {
	const before = queryCache.getQueryData(entriesKey.value)
	queryCache.setQueryData(entriesKey.value, list => list?.map(item => item.id === props.entry.id ? { ...item, tags } : item) ?? [])
	if (!await act(url.value, { method: 'PATCH', body: { tags } }) && before) queryCache.setQueryData(entriesKey.value, before)
}

// A note's text, saved a moment after typing stops, and at once when another entry opens.
const { data: full } = useQuery(() => ({ ...libraryEntryQuery({ libraryId: props.libraryId, entryId: props.entry.id }), enabled: import.meta.client && props.entry.kind === 'note' }))
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
	const key = libraryEntryQuery({ libraryId: props.libraryId, entryId: props.entry.id }).key
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
// Rich text or the raw Markdown, remembered per browser.
const noteMode = useCookie<'rich' | 'raw'>('note-mode', { default: () => 'rich', sameSite: 'lax' })

// The name, renamed in place from the title, as the tree's "Rename" does; the tree's copy changes at once and comes
// back if the server refuses, and is read again after, in its order.
const renaming = ref<string | null>(null)
function startRename() {
	if (!props.readonly) renaming.value = props.entry.name
}
async function saveName() {
	const name = renaming.value?.trim()
	renaming.value = null
	if (!name || name === props.entry.name) return
	const before = queryCache.getQueryData(entriesKey.value)
	queryCache.setQueryData(entriesKey.value, list => list?.map(item => item.id === props.entry.id ? { ...item, name } : item) ?? [])
	if (await act(url.value, { method: 'PATCH', body: { name } })) await queryCache.invalidateQueries({ key: entriesKey.value, exact: true })
	else if (before) queryCache.setQueryData(entriesKey.value, before)
}

// In a lorebook, a note's tags are its keywords, and its options are under "Advanced".
const { data: library } = useQuery(() => libraryQuery(props.libraryId))
const isLorebook = computed(() => props.entry.kind === 'note' && !!library.value?.lorebook?.on)
async function saveLore(lore: Lore) {
	if (!await act(url.value, { method: 'PATCH', body: { lore } })) return
	const key = libraryEntryQuery({ libraryId: props.libraryId, entryId: props.entry.id }).key
	const cached = queryCache.getQueryData(key)
	if (cached) queryCache.setQueryData(key, { ...cached, lore: { ...lore, ...(cached.lore?.kept && { kept: cached.lore.kept }) } })
}

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
const size = computed(() => fileSize(props.entry.size ?? 0))
</script>

<template>
	<div class="flex flex-col min-h-full">
		<div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-6 py-3 border-b border-default">
			<!-- Double-click to rename: Enter or leaving the field saves, Esc puts the name back. -->
			<UInput
				v-if="renaming !== null"
				v-model="renaming"
				autofocus
				size="sm"
				aria-label="Name"
				class="min-w-48"
				@keydown.enter.prevent="saveName"
				@keydown.esc.prevent="renaming = null"
				@blur="saveName"
			/>
			<h2 v-else class="font-semibold text-highlighted truncate" :title="readonly ? undefined : 'Double-click to rename'" @dblclick="startRename">
				{{ entry.name }}
			</h2>
			<template v-if="entry.kind === 'note'">
				<span v-if="!readonly" class="text-xs text-muted">{{ unsaved ? 'Saving…' : 'Saved' }}</span>
				<!-- Rich text or the raw Markdown; both edit the same note. -->
				<UFieldGroup>
					<UTooltip text="Rich text">
						<UButton icon="i-lucide-type" size="xs" color="neutral" :variant="noteMode === 'rich' ? 'soft' : 'ghost'" aria-label="Rich text" :aria-pressed="noteMode === 'rich'" @click="noteMode = 'rich'" />
					</UTooltip>
					<UTooltip text="Raw Markdown">
						<UButton icon="i-lucide-code-xml" size="xs" color="neutral" :variant="noteMode === 'raw' ? 'soft' : 'ghost'" aria-label="Raw Markdown" :aria-pressed="noteMode === 'raw'" @click="noteMode = 'raw'" />
					</UTooltip>
				</UFieldGroup>
			</template>
			<span v-else-if="entry.kind === 'file'" class="text-xs text-muted">{{ size }}</span>
			<UInputTags
				:model-value="entry.tags"
				:placeholder="isLorebook ? 'Add keywords' : 'Add tags'"
				:max="20"
				:max-length="50"
				add-on-blur
				add-on-paste
				delimiter=","
				size="sm"
				variant="subtle"
				icon="i-lucide-tag"
				:aria-label="isLorebook ? 'Keywords' : 'Tags'"
				:disabled="readonly"
				class="ms-auto min-w-56"
				@update:model-value="saveTags"
			/>
		</div>

		<LibraryLoreOptions v-if="isLorebook && full" :lore="full.lore" :readonly="readonly" @save="saveLore" />

		<!-- The editor is the browser's; the server shows the placeholder, so an entry opened from a link hydrates cleanly. -->
		<ClientOnly v-if="entry.kind === 'note'">
			<template v-if="text !== undefined">
				<!-- Raw: the note's Markdown as it is stored. -->
				<UTextarea
					v-if="noteMode === 'raw'"
					v-model="text"
					autoresize
					:rows="16"
					variant="none"
					:readonly="readonly"
					placeholder="Write the note in Markdown…"
					aria-label="The note's Markdown"
					class="w-full"
					:ui="{ base: 'px-6 py-4 min-h-80 font-mono text-sm' }"
				/>
				<UEditor
					v-else
					v-slot="{ editor }"
					v-model="text"
					content-type="markdown"
					:editable="!readonly"
					:extensions="[MarkdownPaste]"
					placeholder="Write the note…"
					:ui="{ base: 'px-6 py-4 min-h-80' }"
					class="w-full"
				>
					<UEditorToolbar v-if="!readonly" :editor="editor" :items="toolbar" class="border-b border-muted px-4 py-1.5 sticky top-0 z-10 bg-default overflow-x-auto" />
				</UEditor>
			</template>
			<div v-else class="flex flex-col gap-2 p-6" aria-busy="true" aria-label="Loading the note">
				<USkeleton v-for="n in 4" :key="n" class="h-5 w-full" />
			</div>
			<template #fallback>
				<div class="flex flex-col gap-2 p-6" aria-busy="true" aria-label="Loading the note">
					<USkeleton v-for="n in 4" :key="n" class="h-5 w-full" />
				</div>
			</template>
		</ClientOnly>

		<div v-else-if="entry.kind === 'file'" class="flex-1 flex flex-col gap-3 p-6">
			<img v-if="isImage" :src="fileUrl" :alt="entry.name" class="max-w-full max-h-[70vh] object-contain self-start rounded-md border border-default">
			<iframe v-else-if="isPdf" :src="fileUrl" :title="entry.name" class="w-full flex-1 min-h-[70vh] rounded-md border border-default" />
			<UButton :to="fileUrl" target="_blank" external icon="i-lucide-download" :label="isImage || isPdf ? 'Open in a new tab' : 'Download'" color="neutral" variant="subtle" class="self-start" />
		</div>

		<UEmpty v-else icon="i-lucide-folder" title="Folder" description="Drag files onto it, or use its menu in the tree to add notes and uploads." class="flex-1" />
	</div>
</template>
