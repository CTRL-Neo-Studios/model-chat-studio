<script setup lang="ts">
import type { DropdownMenuItem, TreeItem } from '@nuxt/ui'
import { LazyModalConfirm, LazyModalFolderDefaults, LazyModalMoveTo, LazyModalRename } from '#components'
import { type FolderDefaults, nearestWithDefaults } from '#shared/utils/folderDefaults'
import type { UIChat } from '~/composables/useChats'

/**
 * The member's chats: folders as a tree (with the chats inside them), then the chats in no folder, by date. A chat
 * or folder dragged onto a folder moves into it, onto the date list out of any folder; "Move to…" does the same
 * from the keyboard.
 */
const props = defineProps<{
	chats: UIChat[]
}>()

const route = useRoute()
const overlay = useOverlay()
const queryCache = useQueryCache()
const act = useApiAction()
const { renameChat, deleteChat } = useChatActions()
const { isPinned, pinnedFirst, pinItem } = usePins()

const { data: folderList } = useQuery(foldersQuery)
const folders = computed(() => folderList.value ?? [])
type Folder = (typeof folders.value)[number]

const renameModal = overlay.create(LazyModalRename)
const moveModal = overlay.create(LazyModalMoveTo)
const confirmModal = overlay.create(LazyModalConfirm)
const defaultsModal = overlay.create(LazyModalFolderDefaults)

// Open folders, kept across visits; a cookie so the server renders them open too.
const expanded = useCookie<string[]>('sidebar-folders', { default: () => [], sameSite: 'lax' })
const expand = (id: string) => {
	if (!expanded.value.includes(id)) expanded.value = [...expanded.value, id]
}

type Kind = 'folder' | 'chat'
interface Row extends TreeItem { id: string, kind: Kind }

const byName = (a: Folder, b: Folder) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
// Pinned folders come first among their sibling folders, pinned chats first among the chats beside them.
const foldersIn = (parentId: string | null) => pinnedFirst('chatFolder', folders.value.filter(folder => folder.parentId === parentId).sort(byName))
function rows(parentId: string): Row[] {
	return [
		...foldersIn(parentId).map(folderRow),
		...pinnedFirst('chat', props.chats.filter(chat => chat.folderId === parentId)).map(chat => ({
			id: chat.id,
			kind: 'chat' as const,
			label: chat.label,
			class: chat.label === 'Untitled' ? 'text-muted' : undefined,
			onSelect: () => navigateTo(chat.to),
		})),
	]
}
function folderRow(folder: Folder): Row {
	const children = rows(folder.id)
	return {
		id: folder.id,
		kind: 'folder',
		label: folder.name,
		icon: 'i-lucide-folder',
		children: children.length ? children : undefined,
		// A folder opens and closes; it is never the selected row.
		onSelect: (event: Event) => event.preventDefault(),
	}
}
const tree = computed(() => foldersIn(null).map(folderRow))
const selected = computed(() => {
	const find = (list: Row[]): Row | undefined => list.reduce<Row | undefined>((hit, row) => hit ?? (row.id === route.params.id ? row : find((row.children ?? []) as Row[])), undefined)
	return find(tree.value)
})

// Chats in no folder: the pinned ones, then the rest by date. Until the folders load, a chat in a folder is not shown at all.
const loose = computed(() => props.chats.filter(chat => !chat.folderId))
const pinnedLoose = computed(() => loose.value.filter(chat => isPinned('chat', chat.id)))
const { groups } = useChats(computed(() => loose.value.filter(chat => !isPinned('chat', chat.id))))
const looseItems = computed(() => [
	...(pinnedLoose.value.length ? [{ label: 'Pinned', items: pinnedLoose.value }] : []),
	...groups.value,
].flatMap(group => [
	{ label: group.label, type: 'label' as const },
	...group.items.map(item => ({ ...item, slot: 'chat' as const, icon: undefined, class: item.label === 'Untitled' ? 'text-muted' : '' })),
]))

const folderOf = (id: string) => folders.value.find(folder => folder.id === id)
const pathOf = (id: string): string => {
	const folder = folderOf(id)
	return folder?.parentId ? `${pathOf(folder.parentId)} / ${folder.name}` : folder?.name ?? ''
}
/** Whether `id` is `ancestor` or a folder inside it. */
function within(id: string | null, ancestor: string) {
	for (let step = 0; id && step <= folders.value.length; step++) {
		if (id === ancestor) return true
		id = folderOf(id)?.parentId ?? null
	}
	return false
}
const currentFolder = (kind: Kind, id: string) => kind === 'chat'
	? props.chats.find(chat => chat.id === id)?.folderId ?? null
	: folderOf(id)?.parentId ?? null
const canMove = (kind: Kind, id: string, folderId: string | null) =>
	currentFolder(kind, id) !== folderId && !(kind === 'folder' && folderId && within(folderId, id))

// Moves, renames and deletions show at once and are undone if the server refuses.
async function moveChat(id: string, folderId: string | null) {
	const before = queryCache.getQueryData(chatsQuery.key)
	queryCache.setQueryData(chatsQuery.key, list => list?.map(chat => chat.id === id ? { ...chat, folderId } : chat) ?? [])
	if (folderId) expand(folderId)
	if (!await act(`/api/v1/chats/${id}`, { method: 'PATCH', body: { folderId } }) && before) queryCache.setQueryData(chatsQuery.key, before)
}

async function changeFolder(id: string, fields: { name?: string, parentId?: string | null }) {
	const before = folderList.value
	queryCache.setQueryData(foldersQuery.key, list => list?.map(folder => folder.id === id ? { ...folder, ...fields } : folder) ?? [])
	if (fields.parentId) expand(fields.parentId)
	if (!await act(`/api/v1/folders/${id}`, { method: 'PATCH', body: fields }) && before) queryCache.setQueryData(foldersQuery.key, before)
}

const move = (kind: Kind, id: string, folderId: string | null) => kind === 'chat' ? moveChat(id, folderId) : changeFolder(id, { parentId: folderId })

async function createFolder(parentId: string | null) {
	const name = await renameModal.open({
		heading: 'New folder',
		description: parentId ? `Inside “${pathOf(parentId)}”.` : 'At the top of your chats.',
		placeholder: 'Folder name',
		maxlength: 100,
	}).result
	if (!name) return
	const folder = await act<Folder>('/api/v1/folders', { method: 'POST', body: { name, parentId } })
	if (!folder) return
	queryCache.setQueryData(foldersQuery.key, list => [...(list ?? []), folder])
	if (parentId) expand(parentId)
}

async function renameFolder(folder: Folder) {
	const name = await renameModal.open({ title: folder.name, heading: 'Rename folder', description: 'Choose a new name for this folder.', placeholder: 'Folder name', maxlength: 100 }).result
	if (name && name !== folder.name) await changeFolder(folder.id, { name })
}

async function moveTo(kind: Kind, id: string, name: string) {
	const targets = folders.value
		.filter(folder => !(kind === 'folder' && within(folder.id, id)))
		.map(folder => ({ id: folder.id, label: pathOf(folder.id) }))
		.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
	const folderId = await moveModal.open({ name, folders: targets, current: currentFolder(kind, id) }).result
	if (folderId !== undefined) await move(kind, id, folderId)
}

async function deleteFolder(folder: Folder) {
	const confirmed = await confirmModal.open({
		title: 'Delete folder',
		description: `“${folder.name}” is deleted. Its chats and folders move to ${folder.parentId ? `“${pathOf(folder.parentId)}”` : 'the top level'}; no chat is deleted.`,
		color: 'error',
	}).result
	if (!confirmed) return
	const before = { chats: queryCache.getQueryData(chatsQuery.key), folders: folderList.value }
	queryCache.setQueryData(chatsQuery.key, list => list?.map(chat => chat.folderId === folder.id ? { ...chat, folderId: folder.parentId } : chat) ?? [])
	queryCache.setQueryData(foldersQuery.key, list => (list ?? [])
		.filter(entry => entry.id !== folder.id)
		.map(entry => entry.parentId === folder.id ? { ...entry, parentId: folder.parentId } : entry))
	if (!await act(`/api/v1/folders/${folder.id}`, { method: 'DELETE' })) {
		if (before.chats) queryCache.setQueryData(chatsQuery.key, before.chats)
		if (before.folders) queryCache.setQueryData(foldersQuery.key, before.folders)
	}
}

// "Defaults…": what new chats started in the folder begin with. `preset` fills the dialog with another setup first.
async function editDefaults(folder: Folder, preset?: FolderDefaults) {
	const inherited = folder.parentId ? nearestWithDefaults(folders.value, folder.parentId) : null
	const defaults = await defaultsModal.open({
		name: folder.name,
		defaults: preset ?? folder.defaults,
		own: !!folder.defaults,
		inherited: inherited && { from: inherited.name, defaults: inherited.defaults },
	}).result
	if (defaults === undefined) return
	const before = folderList.value
	queryCache.setQueryData(foldersQuery.key, list => list?.map(entry => entry.id === folder.id ? { ...entry, defaults } : entry) ?? [])
	if (!await act(`/api/v1/folders/${folder.id}`, { method: 'PATCH', body: { defaults }, success: 'Defaults saved' }) && before) queryCache.setQueryData(foldersQuery.key, before)
}

/** "Use as the folder's defaults…": the chat's models, mode, who you are, settings, libraries and profile, to review and save. */
async function setupAsDefaults(chatId: string, folder: Folder) {
	const { data: chat } = await queryCache.refresh(queryCache.ensure(chatQuery(chatId)))
	if (!chat) return
	await editDefaults(folder, {
		// Only libraries the member can still open: a chat can name others'.
		libraryIds: chat.libraries.flatMap(library => library.role ? [library.id] : []),
		structureProfileId: chat.structureProfileId,
		models: chat.models.map(({ profileId, name, color, modelId, systemPrompt, params, enabled, characterId }) => ({ ...(profileId && { profileId }), name, color, modelId, systemPrompt, params, enabled, characterId })),
		mode: chat.mode,
		userCharacterId: chat.userCharacterId,
		settings: chat.settings,
	})
}

function folderActions(folder: Folder): DropdownMenuItem[][] {
	return [[
		{ label: 'New chat here', icon: 'i-lucide-circle-plus', onSelect: () => navigateTo({ path: '/', query: { folder: folder.id } }) },
		{ label: 'Defaults…', icon: 'i-lucide-library-big', onSelect: () => editDefaults(folder) },
	], [
		pinItem('chatFolder', folder.id),
		{ label: 'New folder', icon: 'i-lucide-folder-plus', onSelect: () => createFolder(folder.id) },
		{ label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => renameFolder(folder) },
		{ label: 'Move to…', icon: 'i-lucide-folder-input', onSelect: () => moveTo('folder', folder.id, folder.name) },
	], [
		{ label: 'Delete', icon: 'i-lucide-trash', color: 'error', onSelect: () => deleteFolder(folder) },
	]]
}

function chatActions(chat: { id: string, label: string }): DropdownMenuItem[][] {
	const folder = folders.value.find(entry => entry.id === props.chats.find(item => item.id === chat.id)?.folderId)
	return [[
		pinItem('chat', chat.id),
		{ label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => renameChat(chat.id, chat.label === 'Untitled' ? '' : chat.label) },
		{ label: 'Move to…', icon: 'i-lucide-folder-input', onSelect: () => moveTo('chat', chat.id, chat.label) },
		...(folder ? [{ label: 'Use as the folder\'s defaults…', icon: 'i-lucide-folder-cog', onSelect: () => setupAsDefaults(chat.id, folder) }] : []),
	], [
		{ label: 'Delete', icon: 'i-lucide-trash', color: 'error' as const, onSelect: () => deleteChat(chat.id) },
	]]
}

// Drag and drop. Tree rows carry `data-drag="kind:id"` on their label; chats in the date list are links.
const dragged = ref<{ kind: Kind, id: string } | null>(null)
/** The folder under the pointer while dragging, or `root` for the date list. */
const over = ref<string | null>(null)

function dragItemOf(target: EventTarget | null): { kind: Kind, id: string } | null {
	if (!(target instanceof Element)) return null
	const [kind, id] = target.closest('[data-drag]')?.getAttribute('data-drag')?.split(':') ?? []
	if ((kind === 'folder' || kind === 'chat') && id) return { kind, id }
	const chatId = target.closest('a')?.getAttribute('href')?.match(/^\/chat\/([\w-]+)$/)?.[1]
	return chatId ? { kind: 'chat', id: chatId } : null
}

/** Where a drop lands: a folder row, a chat row inside a folder (that folder), or the date list (`null`). */
function dropTargetOf(target: EventTarget | null): string | null | undefined {
	if (!(target instanceof Element)) return undefined
	if (target.closest('[data-drop-root]')) return null
	const row = target.closest('[role="treeitem"]')
	const item = row ? dragItemOf(row.querySelector('[data-drag]')) : null
	if (!item) return undefined
	return item.kind === 'folder' ? item.id : currentFolder('chat', item.id)
}

function onDragStart(event: DragEvent) {
	const item = dragItemOf(event.target)
	if (!item || !event.dataTransfer) return
	dragged.value = item
	event.dataTransfer.effectAllowed = 'move'
	event.dataTransfer.setData('text/plain', `${item.kind}:${item.id}`)
}

function onDragOver(event: DragEvent) {
	const target = dropTargetOf(event.target)
	if (!dragged.value || target === undefined || !canMove(dragged.value.kind, dragged.value.id, target)) {
		over.value = null
		return
	}
	event.preventDefault()
	over.value = target ?? 'root'
}

function onDrop(event: DragEvent) {
	const target = dropTargetOf(event.target)
	const item = dragged.value
	onDragEnd()
	if (!item || target === undefined || !canMove(item.kind, item.id, target)) return
	event.preventDefault()
	move(item.kind, item.id, target)
}

function onDragEnd() {
	dragged.value = null
	over.value = null
}

// A chat loads while the pointer is over its row or the row has focus, so opening it is instant.
const prefetch = usePrefetch()
function prefetchChat(event: Event) {
	const item = dragItemOf(event.target)
	if (item?.kind === 'chat') prefetch(chatQuery(item.id))
}
</script>

<template>
	<div
		class="flex flex-col gap-1"
		@dragstart="onDragStart"
		@dragover="onDragOver"
		@drop="onDrop"
		@dragend="onDragEnd"
		@pointerover="prefetchChat"
		@focusin="prefetchChat"
	>
		<div class="flex items-center justify-between ps-2.5 pe-1 h-7 text-xs font-semibold text-highlighted">
			Folders
			<UButton icon="i-lucide-folder-plus" color="neutral" variant="ghost" size="xs" aria-label="New folder" @click="createFolder(null)" />
		</div>

		<UTree
			v-if="tree.length"
			v-model:expanded="expanded"
			:model-value="selected"
			:items="tree"
			:get-key="(item: Row) => item.id"
			:as="{ link: 'div' }"
			:ui="{ link: 'cursor-pointer' }"
		>
			<template #item-label="{ item }">
				<span
					:data-drag="`${item.kind}:${item.id}`"
					draggable="true"
					:class="['truncate flex-1 rounded-sm', over === item.id && 'ring-2 ring-primary']"
				>{{ item.label }}</span>
			</template>
			<template #item-trailing="{ item, ui }">
				<UIcon v-if="isPinned(item.kind === 'folder' ? 'chatFolder' : 'chat', item.id)" name="i-lucide-pin" class="size-3 shrink-0 text-dimmed" aria-label="Pinned" />
				<UIcon v-if="item.children?.length" name="i-lucide-chevron-down" :class="ui.linkTrailingIcon()" />
				<UDropdownMenu :items="item.kind === 'folder' ? folderActions(folderOf(item.id)!) : chatActions(item as { id: string, label: string })" :content="{ align: 'end' }">
					<UButton
						icon="i-lucide-ellipsis"
						color="neutral"
						variant="link"
						size="sm"
						:aria-label="item.kind === 'folder' ? 'Folder actions' : 'Chat actions'"
						class="rounded-[5px] hover:bg-accented/50 focus-visible:bg-accented/50 data-[state=open]:bg-accented/50"
						@click.stop
						@keydown.stop
					/>
				</UDropdownMenu>
			</template>
		</UTree>

		<div data-drop-root :class="['rounded-md min-h-8', over === 'root' && 'ring-2 ring-primary']">
			<UNavigationMenu
				:items="looseItems"
				orientation="vertical"
				:ui="{
					link: 'overflow-hidden pr-7.5',
					linkTrailing: 'translate-x-full group-hover:translate-x-0 group-has-data-[state=open]:translate-x-0 transition-transform ms-0 absolute inset-e-px',
				}"
			>
				<template #chat-trailing="{ item }">
					<UDropdownMenu :items="chatActions(item as { id: string, label: string })" :content="{ align: 'end' }">
						<UButton
							as="div"
							icon="i-lucide-ellipsis"
							color="neutral"
							variant="link"
							size="sm"
							class="rounded-[5px] hover:bg-accented/50 focus-visible:bg-accented/50 data-[state=open]:bg-accented/50"
							aria-label="Chat actions"
							tabindex="-1"
							@click.stop.prevent
						/>
					</UDropdownMenu>
				</template>
			</UNavigationMenu>
		</div>
	</div>
</template>
