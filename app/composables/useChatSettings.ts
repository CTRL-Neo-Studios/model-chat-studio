import type { ChatSettings, ModelParams } from '#shared/utils/chat'

/** A lane as the prompt edits it. `modelId` `null` is the platform's default model. */
export interface LaneDraft {
	modelId: string | null
	params: ModelParams
	systemPrompt: string
}

interface SavedChat {
	id: string
	settings: ChatSettings
	models: { id: string, modelId: string | null, params: ModelParams, systemPrompt: string | null }[]
}

/**
 * The model settings and system prompt of a chat's first lane, and the chat's own settings (web search).
 * A saved chat stores changes, debounced: the lane with `PATCH /chats/:id/models/:laneId`, the settings with
 * `PATCH /chats/:id`. Every send calls `flush()` first so the turn sees them. A new chat starts from the
 * settings last used, kept in a cookie, and sends them when it is created.
 */
export function useChatSettings(chat?: SavedChat) {
	const toast = useToast()
	const { csrf, headerName } = useCsrf()
	const lastUsed = useCookie<{ modelId?: string | null, params?: ModelParams, settings?: ChatSettings }>('chat-defaults', { default: () => ({}), sameSite: 'lax' })

	const saved = chat?.models[0]
	const lane = ref<LaneDraft>(saved
		? { modelId: saved.modelId, params: { ...saved.params }, systemPrompt: saved.systemPrompt ?? '' }
		: { modelId: lastUsed.value.modelId ?? null, params: { ...lastUsed.value.params }, systemPrompt: '' })
	const settings = ref<ChatSettings>({ ...(chat ? chat.settings : lastUsed.value.settings) })

	let timer: ReturnType<typeof setTimeout> | undefined
	let saving: Promise<unknown> = Promise.resolve()
	const pending: Record<'lane' | 'settings', boolean> = { lane: false, settings: false }

	function save() {
		timer = undefined
		const headers = { [headerName]: csrf }
		const requests = [
			pending.lane && $fetch(`/api/v1/chats/${chat!.id}/models/${saved!.id}`, {
				method: 'PATCH',
				headers,
				body: { modelId: lane.value.modelId, params: lane.value.params, systemPrompt: lane.value.systemPrompt || null },
			}),
			pending.settings && $fetch(`/api/v1/chats/${chat!.id}`, { method: 'PATCH', headers, body: { settings: settings.value } }),
		]
		pending.lane = pending.settings = false
		saving = Promise.all(requests).catch(() => {
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

	function changed(what: keyof typeof pending) {
		lastUsed.value = { modelId: lane.value.modelId, params: { ...lane.value.params }, settings: { ...settings.value } }
		if (!saved) return
		pending[what] = true
		clearTimeout(timer)
		timer = setTimeout(save, 600)
	}
	watch(lane, () => changed('lane'), { deep: true })
	watch(settings, () => changed('settings'), { deep: true })

	return { lane, settings, laneId: saved?.id, flush }
}
