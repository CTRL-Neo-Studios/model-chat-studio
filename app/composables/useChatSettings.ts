import type { ChatParams } from '#shared/utils/chat'

interface SavedChat {
	id: string
	params: ChatParams | null
	systemPrompt: string | null
}

/**
 * Model settings and system prompt for one chat. A saved chat stores changes with `PATCH /chats/:id`
 * (debounced; `flush()` before sending, so the turn sees them). A new chat starts from the settings
 * last used, kept in a cookie, and sends them when it is created.
 */
export function useChatSettings(chat?: SavedChat) {
	const toast = useToast()
	const { csrf, headerName } = useCsrf()
	const lastUsed = useCookie<ChatParams>('chat-params', { default: () => ({}), sameSite: 'lax' })

	const params = ref<ChatParams>({ ...(chat ? chat.params : lastUsed.value) })
	const systemPrompt = ref(chat?.systemPrompt ?? '')

	let timer: ReturnType<typeof setTimeout> | undefined
	let saving: Promise<unknown> = Promise.resolve()

	function save() {
		timer = undefined
		saving = $fetch(`/api/v1/chats/${chat!.id}`, {
			method: 'PATCH',
			headers: { [headerName]: csrf },
			body: { params: params.value, systemPrompt: systemPrompt.value || null },
		}).catch(() => {
			toast.add({ description: 'Failed to save the chat settings', icon: 'i-lucide-alert-circle', color: 'error' })
		})
	}

	/** Saves pending changes now and waits for them. */
	async function flush() {
		if (timer) {
			clearTimeout(timer)
			save()
		}
		await saving
	}

	watch([params, systemPrompt], () => {
		lastUsed.value = { ...params.value }
		if (!chat) return
		clearTimeout(timer)
		timer = setTimeout(save, 600)
	}, { deep: true })

	return { params, systemPrompt, flush }
}
