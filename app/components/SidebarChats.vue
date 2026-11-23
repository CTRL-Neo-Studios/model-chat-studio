<script setup lang="ts">
import type { TreeItem } from '@nuxt/ui'
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
const { isPinned } = usePins()
const { expanded, foldersIn, chatsIn, folderOf, currentFolder, canMove, move, createFolder, folderActions, chatActions } = useFolderActions(() => props.chats)

type Kind = 'folder' | 'chat'
interface Row extends TreeItem { id: string, kind: Kind }

function rows(parentId: string): Row[] {
	return [
		...foldersIn(parentId).map(folderRow),
		...chatsIn(parentId).map(chat => ({
			id: chat.id,
			kind: 'chat' as const,
			label: chat.label,
			class: chat.label === 'Untitled' ? 'text-muted' : undefined,
			onSelect: () => navigateTo(chat.to),
		})),
	]
}
function folderRow(folder: { id: string, name: string }): Row {
	const children = rows(folder.id)
	return {
		id: folder.id,
		kind: 'folder',
		label: folder.name,
		icon: 'i-lucide-folder',
		children: children.length ? children : undefined,
		// A click opens and closes the folder; "Open folder" in its menu goes to its page, where its row is selected.
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
