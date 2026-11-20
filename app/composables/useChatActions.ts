import { LazyModalConfirm, LazyModalRename } from '#components'

interface ChatListItem {
	id: string
	label: string
}

export function useChatActions() {
	const route = useRoute()
	const toast = useToast()
	const overlay = useOverlay()
	const { csrf, headerName } = useCsrf()

	const renameModal = overlay.create(LazyModalRename)
	const deleteModal = overlay.create(LazyModalConfirm, {
		props: {
			title: 'Delete chat',
			description: 'Are you sure you want to delete this chat? This cannot be undone.',
			color: 'error',
		},
	})

	async function renameChat(id: string, currentTitle?: string | null): Promise<string | null> {
		const result = await renameModal.open({ title: currentTitle ?? '' }).result
		if (!result || result === currentTitle) return null

		try {
			await $fetch(`/api/v1/chats/${id}`, {
				method: 'PATCH',
				headers: { [headerName]: csrf },
				body: { title: result },
			})
		}
		catch {
			toast.add({ description: 'Failed to rename chat', icon: 'i-lucide-alert-circle', color: 'error' })
			return null
		}

		const chats = useNuxtData<ChatListItem[]>('chats')
		if (chats.data.value) {
			chats.data.value = chats.data.value.map(chat => chat.id === id ? { ...chat, label: result } : chat)
		}
		return result
	}

	async function deleteChat(id: string): Promise<boolean> {
		if (!await deleteModal.open().result) return false

		try {
			await $fetch(`/api/v1/chats/${id}`, {
				method: 'DELETE',
				headers: { [headerName]: csrf },
			})
		}
		catch {
			toast.add({ description: 'Failed to delete chat', icon: 'i-lucide-alert-circle', color: 'error' })
			return false
		}

		toast.add({ title: 'Chat deleted', description: 'Your chat has been deleted', icon: 'i-lucide-trash' })
		const chats = useNuxtData<ChatListItem[]>('chats')
		if (chats.data.value) {
			chats.data.value = chats.data.value.filter(chat => chat.id !== id)
		}
		if (route.params.id === id) await navigateTo('/')
		return true
	}

	return { renameChat, deleteChat }
}
