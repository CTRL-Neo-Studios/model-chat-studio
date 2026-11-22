<script setup lang="ts">
import type { DropdownMenuItem, TreeItem } from '@nuxt/ui'
import { LazyModalConfirm, LazyModalMoveTo, LazyModalRename } from '#components'
import { fileAcceptPattern, getFileIcon } from '#shared/utils/file'

/**
 * A project's file space: folders, uploads and notes as a tree, with the open entry beside it. An entry dragged
 * onto a folder (or onto anything inside one) moves into it, onto the space below the tree to the top level;
 * files dragged in from the computer upload there. "Move to…" does the same from the keyboard.
 */
const props = defineProps<{ projectId: string }>()
/** The open entry's id. */
const selected = defineModel<string | undefined>('selected')

const overlay = useOverlay()
const toast = useToast()
const queryCache = useQueryCache()
const act = useApiAction()
const { csrf, headerName } = useCsrf()

const entriesKey = computed(() => projectEntriesQuery(props.projectId).key)
const { data, isPending } = useQuery(() => projectEntriesQuery(props.projectId))
const entries = computed(() => data.value ?? [])
type Entry = (typeof entries.value)[number]
const setEntries = (update: (list: Entry[]) => Entry[]) => queryCache.setQueryData(entriesKey.value, list => update(list ?? []))

const nameModal = overlay.create(LazyModalRename)
const moveModal = overlay.create(LazyModalMoveTo)
const confirmModal = overlay.create(LazyModalConfirm)

const expanded = ref<string[]>([])
const expand = (id: string | null) => {
	if (id && !expanded.value.includes(id)) expanded.value = [...expanded.value, id]
}

const entryOf = (id: string | null | undefined) => entries.value.find(entry => entry.id === id)
const pathOf = (id: string): string => {
	const entry = entryOf(id)
	return entry?.parentId ? `${pathOf(entry.parentId)} / ${entry.name}` : entry?.name ?? ''
}
/** Whether `id` is `ancestor` or inside it. */
function within(id: string | null, ancestor: string) {
	for (let step = 0; id && step <= entries.value.length; step++) {
		if (id === ancestor) return true
		id = entryOf(id)?.parentId ?? null
	}
	return false
}
const canMove = (entry: Entry, parentId: string | null) => entry.parentId !== parentId && !(entry.kind === 'folder' && parentId && within(parentId, entry.id))
/** The folder new entries go into: the open folder, or the folder of the open entry. */
const targetFolder = computed(() => {
	const open = entryOf(selected.value)
	return open ? (open.kind === 'folder' ? open.id : open.parentId) : null
})

interface Row extends TreeItem { id: string, kind: Entry['kind'] }
const iconOf = (entry: Entry) => entry.kind === 'folder' ? 'i-lucide-folder' : entry.kind === 'note' ? 'i-lucide-notebook-pen' : getFileIcon(entry.mediaType ?? '')
// The server sends folders first, then by name; children keep that order.
function rows(parentId: string | null): Row[] {
	return entries.value.filter(entry => entry.parentId === parentId).map((entry) => {
		const children = entry.kind === 'folder' ? rows(entry.id) : []
		return {
			id: entry.id,
			kind: entry.kind,
			label: entry.name,
			icon: iconOf(entry),
			children: children.length ? children : undefined,
			onSelect: () => {
				selected.value = entry.id
			},
		}
	})
}
const tree = computed(() => rows(null))
const selectedRow = computed(() => {
	const find = (list: Row[]): Row | undefined => list.reduce<Row | undefined>((hit, row) => hit ?? (row.id === selected.value ? row : find((row.children ?? []) as Row[])), undefined)
	return find(tree.value)
})
// Opening an entry from a link shows it inside its folders.
watch([selected, entries], () => {
	for (let id = entryOf(selected.value)?.parentId ?? null; id; id = entryOf(id)?.parentId ?? null) expand(id)
}, { immediate: true })

const base = computed(() => `/api/v1/projects/${props.projectId}/entries`)
const nameProps = { placeholder: 'Name', maxlength: 255 }
const where = (parentId: string | null) => parentId ? `Inside “${pathOf(parentId)}”.` : 'At the top of the project.'

async function create(kind: 'folder' | 'note', parentId: string | null) {
	const name = await nameModal.open({ ...nameProps, heading: kind === 'folder' ? 'New folder' : 'New note', description: where(parentId) }).result
	if (!name) return
	const entry = await act<Entry>(base.value, { method: 'POST', body: { kind, name, parentId } })
	if (!entry) return
	setEntries(list => [...list, { ...entry, mediaType: null, size: null }].sort(byTreeOrder))
	expand(parentId)
	if (kind === 'note') selected.value = entry.id
}
const byTreeOrder = (a: Entry, b: Entry) => Number(a.kind !== 'folder') - Number(b.kind !== 'folder') || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

// Changes show at once and are undone if the server refuses.
async function change(entry: Entry, fields: { name?: string, parentId?: string | null }) {
	const before = entries.value
	setEntries(list => list.map(item => item.id === entry.id ? { ...item, ...fields } : item).sort(byTreeOrder))
	if (fields.parentId) expand(fields.parentId)
	if (!await act(`${base.value}/${entry.id}`, { method: 'PATCH', body: fields })) queryCache.setQueryData(entriesKey.value, before)
}

async function rename(entry: Entry) {
	const name = await nameModal.open({ ...nameProps, title: entry.name, heading: `Rename ${entry.kind}`, description: 'Choose a new name.' }).result
	if (name && name !== entry.name) await change(entry, { name })
}

async function moveTo(entry: Entry) {
	const targets = entries.value
		.filter(item => item.kind === 'folder' && !(entry.kind === 'folder' && within(item.id, entry.id)))
		.map(item => ({ id: item.id, label: pathOf(item.id) }))
		.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
	const parentId = await moveModal.open({ name: entry.name, folders: targets, current: entry.parentId, rootLabel: 'Top of the project' }).result
	if (parentId !== undefined) await change(entry, { parentId })
}

async function remove(entry: Entry) {
	const confirmed = await confirmModal.open({
		title: `Delete ${entry.kind}`,
		description: entry.kind === 'folder' ? `“${entry.name}” and everything in it are deleted.` : `“${entry.name}” is deleted.`,
		color: 'error',
	}).result
	if (!confirmed) return
	const before = entries.value
	setEntries(list => list.filter(item => !within(item.id, entry.id)))
	if (selected.value && within(selected.value, entry.id)) selected.value = undefined
	if (!await act(`${base.value}/${entry.id}`, { method: 'DELETE' })) queryCache.setQueryData(entriesKey.value, before)
}

// Uploads go one at a time, in the order picked; each shows in the tree once it is stored.
const uploading = ref(0)
async function upload(files: File[], parentId: string | null) {
	uploading.value += files.length
	expand(parentId)
	for (const file of files) {
		const form = new FormData()
		form.append('file', file)
		if (parentId) form.append('parentId', parentId)
		try {
			const entry = await $fetch<Entry>(`/api/v1/projects/${props.projectId}/files`, { method: 'PUT', headers: { [headerName]: csrf }, body: form })
			setEntries(list => [...list, entry].sort(byTreeOrder))
		}
		catch (error) {
			toast.add({ title: `Could not upload ${file.name}`, description: serverMessage(error), icon: 'i-lucide-alert-circle', color: 'error' })
		}
		uploading.value--
	}
}
const picker = useTemplateRef('picker')
const pickInto = ref<string | null>(null)
function pickFiles(parentId: string | null) {
	pickInto.value = parentId
	picker.value?.click()
}
function onPicked(event: Event) {
	if (!(event.target instanceof HTMLInputElement) || !event.target.files) return
	upload([...event.target.files], pickInto.value)
	event.target.value = ''
}

function actions(entry: Entry): DropdownMenuItem[][] {
	return [
		...(entry.kind === 'folder'
			? [[
					{ label: 'New folder', icon: 'i-lucide-folder-plus', onSelect: () => create('folder', entry.id) },
					{ label: 'New note', icon: 'i-lucide-notebook-pen', onSelect: () => create('note', entry.id) },
					{ label: 'Upload here', icon: 'i-lucide-upload', onSelect: () => pickFiles(entry.id) },
				]]
			: []),
		[
			{ label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => rename(entry) },
			{ label: 'Move to…', icon: 'i-lucide-folder-input', onSelect: () => moveTo(entry) },
		],
		[{ label: 'Delete', icon: 'i-lucide-trash', color: 'error', onSelect: () => remove(entry) }],
	]
}

// Drag and drop. Rows carry `data-drag="<id>"` on their label.
const dragged = ref<string | null>(null)
/** The folder under the pointer while dragging, or `root` for the space below the tree. */
const over = ref<string | null>(null)

/** Where a drop lands: a folder row, the folder of any other row, or the top level (`null`). */
function dropTargetOf(target: EventTarget | null): string | null | undefined {
	if (!(target instanceof Element)) return undefined
	if (target.closest('[data-drop-root]')) return null
	const id = target.closest('[role="treeitem"]')?.querySelector('[data-drag]')?.getAttribute('data-drag')
	const entry = entryOf(id)
	if (!entry) return undefined
	return entry.kind === 'folder' ? entry.id : entry.parentId
}
const carriesFiles = (event: DragEvent) => !!event.dataTransfer?.types.includes('Files')

function onDragStart(event: DragEvent) {
	const id = event.target instanceof Element ? event.target.closest('[data-drag]')?.getAttribute('data-drag') : null
	if (!id || !event.dataTransfer) return
	dragged.value = id
	event.dataTransfer.effectAllowed = 'move'
	event.dataTransfer.setData('text/plain', id)
}

function onDragOver(event: DragEvent) {
	const target = dropTargetOf(event.target)
	const entry = entryOf(dragged.value)
	if (target === undefined || !(carriesFiles(event) || (entry && canMove(entry, target)))) {
		over.value = null
		return
	}
	event.preventDefault()
	over.value = target ?? 'root'
}

function onDrop(event: DragEvent) {
	const target = dropTargetOf(event.target)
	const entry = entryOf(dragged.value)
	const files = [...event.dataTransfer?.files ?? []]
	onDragEnd()
	if (target === undefined) return
	event.preventDefault()
	if (files.length) upload(files, target)
	else if (entry && canMove(entry, target)) change(entry, { parentId: target })
}

function onDragEnd() {
	dragged.value = null
	over.value = null
}
</script>

<template>
	<div class="flex flex-1 min-h-0">
		<div
			class="w-72 shrink-0 flex flex-col gap-1 border-e border-default p-2 overflow-y-auto"
			@dragstart="onDragStart"
			@dragover="onDragOver"
			@drop="onDrop"
			@dragend="onDragEnd"
		>
			<div class="flex items-center gap-1 ps-2 h-8">
				<span class="text-xs font-semibold text-highlighted flex-1">Files</span>
				<UTooltip text="New folder">
					<UButton icon="i-lucide-folder-plus" color="neutral" variant="ghost" size="xs" aria-label="New folder" @click="create('folder', targetFolder)" />
				</UTooltip>
				<UTooltip text="New note">
					<UButton icon="i-lucide-notebook-pen" color="neutral" variant="ghost" size="xs" aria-label="New note" @click="create('note', targetFolder)" />
				</UTooltip>
				<UTooltip text="Upload files">
					<UButton icon="i-lucide-upload" color="neutral" variant="ghost" size="xs" aria-label="Upload files" :loading="uploading > 0" @click="pickFiles(targetFolder)" />
				</UTooltip>
				<input ref="picker" type="file" multiple class="hidden" :accept="fileAcceptPattern({ images: true, pdf: true })" @change="onPicked">
			</div>

			<div v-if="isPending" class="flex flex-col gap-2 p-2" aria-busy="true" aria-label="Loading files">
				<USkeleton v-for="n in 4" :key="n" class="h-6 w-full" />
			</div>
			<UTree
				v-else-if="tree.length"
				v-model:expanded="expanded"
				:model-value="selectedRow"
				:items="tree"
				:get-key="(item: Row) => item.id"
				:as="{ link: 'div' }"
				:ui="{ link: 'cursor-pointer' }"
			>
				<template #item-label="{ item }">
					<span
						:data-drag="item.id"
						draggable="true"
						:class="['truncate flex-1 rounded-sm', over === item.id && 'ring-2 ring-primary']"
					>{{ item.label }}</span>
				</template>
				<template #item-trailing="{ item, ui }">
					<UIcon v-if="item.children?.length" name="i-lucide-chevron-down" :class="ui.linkTrailingIcon()" />
					<UDropdownMenu :items="actions(entryOf(item.id)!)" :content="{ align: 'end' }">
						<UButton
							icon="i-lucide-ellipsis"
							color="neutral"
							variant="link"
							size="sm"
							:aria-label="`Actions for ${item.label}`"
							class="rounded-[5px] hover:bg-accented/50 focus-visible:bg-accented/50 data-[state=open]:bg-accented/50"
							@click.stop
							@keydown.stop
						/>
					</UDropdownMenu>
				</template>
			</UTree>

			<!-- A click here closes the open entry, so new folders and notes go to the top. -->
			<div
				data-drop-root
				:class="['flex-1 min-h-16 rounded-md flex items-center justify-center p-4 text-xs text-dimmed text-center', over === 'root' && 'ring-2 ring-primary']"
				@click="selected = undefined"
			>
				{{ tree.length ? 'Drop here to move to the top. Click to add at the top.' : 'No files yet. Upload, drop files here, or add a note.' }}
			</div>
		</div>

		<div class="flex-1 min-w-0 overflow-y-auto">
			<ProjectEntry v-if="entryOf(selected)" :key="selected" :project-id="projectId" :entry="entryOf(selected)!" />
			<UEmpty v-else icon="i-lucide-mouse-pointer-click" title="Nothing open" description="Pick a file or a note to see it here." class="h-full" />
		</div>
	</div>
</template>
