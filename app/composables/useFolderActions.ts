import type { DropdownMenuItem } from '@nuxt/ui'
import { LazyModalConfirm, LazyModalFolderDefaults, LazyModalMoveTo, LazyModalRename } from '#components'
import { type FolderDefaults, nearestWithDefaults } from '#shared/utils/folderDefaults'
import type { UIChat } from '~/composables/useChats'

type Kind = 'folder' | 'chat'

/**
 * The member's folders and what can be done to them and to the chats in them: the menus of the sidebar and of a
 * folder's page. Moves, renames and deletions show at once and are undone if the server refuses.
 */
export function useFolderActions(chats: () => UIChat[]) {
	const route = useRoute()
	const overlay = useOverlay()
	const queryCache = useQueryCache()
	const act = useApiAction()
	const { renameChat, deleteChat, exportChat } = useChatActions()
	const { pinnedFirst, pinItem } = usePins()

	const { data: folderList } = useQuery(foldersQuery)
	const folders = computed(() => folderList.value ?? [])
	type Folder = (typeof folders.value)[number]

	const renameModal = overlay.create(LazyModalRename)
	const moveModal = overlay.create(LazyModalMoveTo)
	const confirmModal = overlay.create(LazyModalConfirm)
	const defaultsModal = overlay.create(LazyModalFolderDefaults)

	// Open folders in the sidebar, kept across visits; a cookie so the server renders them open too.
	const expanded = useCookie<string[]>('sidebar-folders', { default: () => [], sameSite: 'lax' })
	const expand = (id: string) => {
		if (!expanded.value.includes(id)) expanded.value = [...expanded.value, id]
	}

	const byName = (a: Folder, b: Folder) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
	/** The folders inside `parentId` (`null`: the top), pinned first, then by name. */
	const foldersIn = (parentId: string | null) => pinnedFirst('chatFolder', folders.value.filter(folder => folder.parentId === parentId).sort(byName))
	/** The chats in a folder, pinned first, then newest. */
	const chatsIn = (folderId: string) => pinnedFirst('chat', chats().filter(chat => chat.folderId === folderId))

	const folderOf = (id: string) => folders.value.find(folder => folder.id === id)
	/** The folders above `id`, from the top. Bounded by the number of folders, so a cycle cannot loop. */
	function ancestorsOf(id: string) {
		const path: Folder[] = []
		for (let parent = folderOf(id)?.parentId; parent && path.length < folders.value.length;) {
			const folder = folderOf(parent)
			if (!folder) break
			path.unshift(folder)
			parent = folder.parentId
		}
		return path
	}
	const pathOf = (id: string) => [...ancestorsOf(id), folderOf(id)].flatMap(folder => folder?.name ?? []).join(' / ')
	/** Whether `id` is `ancestor` or a folder inside it. */
	function within(id: string | null, ancestor: string) {
		for (let step = 0; id && step <= folders.value.length; step++) {
			if (id === ancestor) return true
			id = folderOf(id)?.parentId ?? null
		}
		return false
	}
	const currentFolder = (kind: Kind, id: string) => kind === 'chat'
		? chats().find(chat => chat.id === id)?.folderId ?? null
		: folderOf(id)?.parentId ?? null
	const canMove = (kind: Kind, id: string, folderId: string | null) =>
		currentFolder(kind, id) !== folderId && !(kind === 'folder' && folderId && within(folderId, id))

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
		// From its own page, to the folder its contents moved to.
		if (route.path === `/folders/${folder.id}`) await navigateTo(folder.parentId ? `/folders/${folder.parentId}` : '/')
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
		if (!await act(`/api/v1/folders/${folder.id}`, { method: 'PATCH', body: { defaults }, success: 'Defaults saved' })) {
			if (before) queryCache.setQueryData(foldersQuery.key, before)
			return
		}
		// Every folder below may start from these, so every folder's start is read again.
		await queryCache.invalidateQueries({ key: ['folders'] })
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
		const page = `/folders/${folder.id}`
		return [[
			...(route.path !== page ? [{ label: 'Open folder', icon: 'i-lucide-folder-open', to: page }] : []),
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
		const folder = folderOf(currentFolder('chat', chat.id) ?? '')
		return [[
			pinItem('chat', chat.id),
			{ label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => renameChat(chat.id, chat.label === 'Untitled' ? '' : chat.label) },
			{ label: 'Move to…', icon: 'i-lucide-folder-input', onSelect: () => moveTo('chat', chat.id, chat.label) },
			{ label: 'Export…', icon: 'i-lucide-download', onSelect: () => exportChat(chat.id) },
			...(folder ? [{ label: 'Use as the folder\'s defaults…', icon: 'i-lucide-folder-cog', onSelect: () => setupAsDefaults(chat.id, folder) }] : []),
		], [
			{ label: 'Delete', icon: 'i-lucide-trash', color: 'error' as const, onSelect: () => deleteChat(chat.id) },
		]]
	}

	return { folders, expanded, foldersIn, chatsIn, folderOf, ancestorsOf, currentFolder, canMove, move, createFolder, editDefaults, folderActions, chatActions }
}
