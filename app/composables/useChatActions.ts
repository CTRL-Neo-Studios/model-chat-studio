import { LazyModalConfirm, LazyModalExportChat, LazyModalRename } from '#components'

export function useChatActions() {
	const route = useRoute()
	const toast = useToast()
	const overlay = useOverlay()
	const queryCache = useQueryCache()
	const { csrf, headerName } = useCsrf()

	const renameModal = overlay.create(LazyModalRename)
	const exportModal = overlay.create(LazyModalExportChat)
	const deleteModal = overlay.create(LazyModalConfirm, {
		props: {
			title: 'Delete chat',
			description: 'Are you sure you want to delete this chat? This cannot be undone.',
			color: 'error',
		},
	})

	/** Sets a chat's title in the cached list and chat. */
	function setTitle(id: string, title: string | null) {
		queryCache.setQueryData(chatsQuery.key, chats => chats?.map(chat => chat.id === id ? { ...chat, title } : chat) ?? [])
		const chat = queryCache.getQueryData(chatQuery(id).key)
		if (chat) queryCache.setQueryData(chatQuery(id).key, { ...chat, title })
	}

	async function renameChat(id: string, currentTitle?: string | null): Promise<string | null> {
		const result = await renameModal.open({ title: currentTitle ?? '' }).result
		if (!result || result === currentTitle) return null

		// Shown at once; the old title comes back if the server refuses.
		setTitle(id, result)
		try {
			await $fetch(`/api/v1/chats/${id}`, {
				method: 'PATCH',
				headers: { [headerName]: csrf },
				body: { title: result },
			})
		}
		catch {
			setTitle(id, currentTitle ?? null)
			toast.add({ description: 'Failed to rename chat', icon: 'i-lucide-alert-circle', color: 'error' })
			return null
		}
		return result
	}

	async function deleteChat(id: string): Promise<boolean> {
		if (!await deleteModal.open().result) return false

		// Gone from the list at once; it comes back if the server refuses.
		const snapshot = queryCache.getQueryData(chatsQuery.key)
		queryCache.setQueryData(chatsQuery.key, chats => chats?.filter(chat => chat.id !== id) ?? [])
		if (route.params.id === id) await navigateTo('/')
		try {
			await $fetch(`/api/v1/chats/${id}`, {
				method: 'DELETE',
				headers: { [headerName]: csrf },
			})
		}
		catch {
			if (snapshot) queryCache.setQueryData(chatsQuery.key, snapshot)
			toast.add({ description: 'Failed to delete chat', icon: 'i-lucide-alert-circle', color: 'error' })
			return false
		}

		toast.add({ title: 'Chat deleted', description: 'Your chat has been deleted', icon: 'i-lucide-trash' })
		for (const entry of queryCache.getEntries({ key: chatQuery(id).key })) queryCache.remove(entry)
		return true
	}

	/** "Export…": the dialog that picks the format and downloads it. */
	function exportChat(id: string) {
		exportModal.open({ chatId: id })
	}

	/**
	 * "Import chat…": a chat file (or a format a reader takes) becomes a new chat, in `folderId` when given, which then
	 * opens; what the import changed is noted.
	 */
	const picker = useFileDialog({ accept: '.json,application/json', multiple: false, reset: true })
	let importFolder: string | undefined
	function importChat(folderId?: string) {
		importFolder = folderId
		picker.open()
	}
	picker.onChange(async (files) => {
		const file = files?.[0]
		if (!file) return
		const form = new FormData()
		form.append('file', file)
		if (importFolder) form.append('folderId', importFolder)
		try {
			const imported = await $fetch<{ id: string, notes: string[] }>('/api/v1/chats/import', { method: 'POST', headers: { [headerName]: csrf }, body: form })
			await queryCache.invalidateQueries({ key: chatsQuery.key, exact: true })
			await navigateTo(`/chat/${imported.id}`)
			toast.add({
				title: 'Chat imported',
				description: imported.notes.length ? imported.notes.join('. ').concat('.').replace(/^./, letter => letter.toUpperCase()) : undefined,
				icon: 'i-lucide-file-up',
				color: imported.notes.length ? 'warning' : 'success',
				duration: imported.notes.length ? 15_000 : undefined,
			})
		}
		catch (error) {
			toast.add({ title: 'The chat could not be imported', description: serverMessage(error), icon: 'i-lucide-alert-circle', color: 'error' })
		}
	})

	return { renameChat, deleteChat, exportChat, importChat }
}
