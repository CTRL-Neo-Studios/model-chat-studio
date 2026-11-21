import type { ChatSettings, LaneFields } from '#shared/utils/chat'

/** A lane: one model answering in a chat. A new chat's lanes are drafts with client-made ids until it is created. */
export interface Lane extends LaneFields {
	id: string
	profileId: string | null
	position: number
	platform: string | null
}

/** What a lane can start from: a profile's fields. */
export interface LaneSource {
	id: string
	name: string
	color: LaneFields['color']
	modelId: string
	systemPrompt: string | null
	params: LaneFields['params']
}

interface SavedChat {
	id: string
	settings: ChatSettings
	models: Lane[]
}

/**
 * A chat's lanes and shared settings. On a saved chat every change is sent to the server at once; on a new chat
 * (no `chat`) they are drafts, sent when the chat is created.
 */
export function useChatLanes(chat?: SavedChat) {
	const act = useApiAction()
	const { resolveModel } = useModels()
	const base = chat && `/api/v1/chats/${chat.id}`

	const lanes = ref<Lane[]>(chat ? chat.models.map(lane => ({ ...lane })) : [])
	const settings = ref<ChatSettings>({ ...chat?.settings })
	const enabledLanes = computed(() => lanes.value.filter(lane => lane.enabled))

	/** The model a lane answers with: its own while offered, else the platform's default. */
	const laneModel = (lane: Pick<Lane, 'modelId'>) => resolveModel(lane.modelId ?? undefined)
	const laneName = (lane: Pick<Lane, 'name' | 'modelId'>) => lane.name ?? laneModel(lane)?.name ?? lane.modelId ?? 'Default model'

	function draft(fields: Partial<Lane>): Lane {
		return { id: crypto.randomUUID(), profileId: null, position: 0, platform: null, enabled: true, name: null, color: null, modelId: null, systemPrompt: null, params: {}, ...fields }
	}
	const fromProfile = (profile: LaneSource): Partial<Lane> => ({
		profileId: profile.id, name: profile.name, color: profile.color, modelId: profile.modelId, systemPrompt: profile.systemPrompt, params: { ...profile.params },
	})

	function replace(lane: Lane) {
		lanes.value = lanes.value.map(entry => entry.id === lane.id ? lane : entry)
	}

	/** Adds a lane from a profile or a model id. On a saved chat it answers from the next message on. */
	async function add(source: { profile: LaneSource } | { modelId: string | null }) {
		if (!base) {
			lanes.value = [...lanes.value, draft('profile' in source ? fromProfile(source.profile) : { modelId: source.modelId })]
			return
		}
		const body = 'profile' in source ? { profileId: source.profile.id } : { modelId: source.modelId }
		const lane = await act<Lane>(`${base}/models`, { method: 'POST', body })
		if (lane) lanes.value = [...lanes.value, lane]
	}

	/** A copy in this chat. The profile itself is not copied; the copy stays linked to it. */
	async function duplicate(lane: Lane) {
		if (!base) {
			const { id: _, ...fields } = lane
			lanes.value = [...lanes.value, draft(fields)]
			return
		}
		const copy = await act<Lane>(`${base}/models`, { method: 'POST', body: { duplicateOf: lane.id } })
		if (copy) lanes.value = [...lanes.value, copy]
	}

	async function update(lane: Lane, fields: Partial<LaneFields>) {
		if (!base) return replace({ ...lane, ...fields })
		const saved = await act<Lane>(`${base}/models/${lane.id}`, { method: 'PATCH', body: fields })
		if (saved) replace(saved)
	}

	async function remove(lane: Lane) {
		if (lanes.value.length <= 1) return
		if (base && !await act(`${base}/models/${lane.id}`, { method: 'DELETE' })) return
		lanes.value = lanes.value.filter(entry => entry.id !== lane.id)
	}

	/** Moves a lane one place; on a saved chat the two lanes swap positions. */
	async function move(lane: Lane, offset: -1 | 1) {
		const index = lanes.value.findIndex(entry => entry.id === lane.id)
		const other = lanes.value[index + offset]
		if (!other) return
		const order = [...lanes.value]
		order[index] = other
		order[index + offset] = lane
		lanes.value = order
		if (!base) return
		await Promise.all([
			act(`${base}/models/${lane.id}`, { method: 'PATCH', body: { position: other.position } }),
			act(`${base}/models/${other.id}`, { method: 'PATCH', body: { position: lane.position } }),
		])
		;[lane.position, other.position] = [other.position, lane.position]
	}

	/** Writes a saved lane back to its profile. */
	async function applyToProfile(lane: Lane) {
		return !!await act(`${base}/models/${lane.id}/apply`, { method: 'POST', success: 'Profile updated' })
	}

	async function setSettings(changes: Partial<ChatSettings>) {
		settings.value = { ...settings.value, ...changes }
		if (base) await act(base, { method: 'PATCH', body: { settings: settings.value } })
	}

	return { saved: !!chat, lanes, settings, enabledLanes, laneModel, laneName, draft, fromProfile, add, duplicate, update, remove, move, applyToProfile, setSettings }
}

export type ChatLanes = ReturnType<typeof useChatLanes>
