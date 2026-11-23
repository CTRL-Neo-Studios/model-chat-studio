import type { ChatSettings, LaneFields } from '#shared/utils/chat'
import { characterAvatarUrl } from '#shared/utils/character'

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
	characterId: string | null
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
	// A lane with a Character is called by the Character's name, and wears its colour unless it has its own.
	const { data: characterList } = useQuery(charactersQuery)
	const laneCharacter = (lane: Pick<Lane, 'characterId'>) => lane.characterId ? characterList.value?.find(character => character.id === lane.characterId) : undefined
	const laneName = (lane: Pick<Lane, 'name' | 'modelId' | 'characterId'>) => laneCharacter(lane)?.name ?? lane.name ?? laneModel(lane)?.name ?? lane.modelId ?? 'Default model'
	const laneColor = (lane: Pick<Lane, 'color' | 'characterId'>) => lane.color ?? laneCharacter(lane)?.color ?? null
	/** The lane's Character's avatar, if it has one. */
	const laneAvatar = (lane: Pick<Lane, 'characterId'>) => {
		const character = laneCharacter(lane)
		return character && characterAvatarUrl(character)
	}

	function draft(fields: Partial<Lane>): Lane {
		return { id: crypto.randomUUID(), profileId: null, position: 0, platform: null, enabled: true, name: null, color: null, modelId: null, systemPrompt: null, params: {}, characterId: null, ...fields }
	}
	const fromProfile = (profile: LaneSource): Partial<Lane> => ({
		profileId: profile.id, name: profile.name, color: profile.color, modelId: profile.modelId, systemPrompt: profile.systemPrompt, params: { ...profile.params }, characterId: profile.characterId,
	})

	function replace(lane: Lane) {
		lanes.value = lanes.value.map(entry => entry.id === lane.id ? lane : entry)
	}

	/** A lane being added on a saved chat; adding needs the server's id. */
	const adding = ref(false)

	/** Adds a lane from a profile or a model id. On a saved chat it answers from the next message on. */
	async function add(source: { profile: LaneSource } | { modelId: string | null }) {
		if (!base) {
			lanes.value = [...lanes.value, draft('profile' in source ? fromProfile(source.profile) : { modelId: source.modelId })]
			return
		}
		const body = 'profile' in source ? { profileId: source.profile.id } : { modelId: source.modelId }
		adding.value = true
		const lane = await act<Lane>(`${base}/models`, { method: 'POST', body })
		adding.value = false
		if (lane) lanes.value = [...lanes.value, lane]
	}

	/** A copy in this chat. The profile itself is not copied; the copy stays linked to it. */
	async function duplicate(lane: Lane) {
		if (!base) {
			const { id: _, ...fields } = lane
			lanes.value = [...lanes.value, draft(fields)]
			return
		}
		adding.value = true
		const copy = await act<Lane>(`${base}/models`, { method: 'POST', body: { duplicateOf: lane.id } })
		adding.value = false
		if (copy) lanes.value = [...lanes.value, copy]
	}

	// Changes to a saved chat show at once and are undone (with the server's message) if the server refuses.
	// A response only applies while the lane is still as this change left it, so a later change wins.
	async function update(lane: Lane, fields: Partial<LaneFields>) {
		const changed = { ...lane, ...fields }
		replace(changed)
		if (!base) return
		const saved = await act<Lane>(`${base}/models/${lane.id}`, { method: 'PATCH', body: fields })
		if (toRaw(lanes.value.find(entry => entry.id === lane.id)) === changed) replace(saved ?? lane)
	}

	async function remove(lane: Lane) {
		if (lanes.value.length <= 1) return
		const before = lanes.value
		lanes.value = before.filter(entry => entry.id !== lane.id)
		if (base && !await act(`${base}/models/${lane.id}`, { method: 'DELETE' })) lanes.value = before
	}

	/** Moves a lane one place; on a saved chat the two lanes swap positions. */
	async function move(lane: Lane, offset: -1 | 1) {
		const index = lanes.value.findIndex(entry => entry.id === lane.id)
		const other = lanes.value[index + offset]
		if (!other) return
		const before = lanes.value
		const order = [...before]
		order[index] = { ...other, position: lane.position }
		order[index + offset] = { ...lane, position: other.position }
		lanes.value = order
		if (!base) return
		const results = await Promise.all([
			act(`${base}/models/${lane.id}`, { method: 'PATCH', body: { position: other.position } }),
			act(`${base}/models/${other.id}`, { method: 'PATCH', body: { position: lane.position } }),
		])
		if (results.includes(undefined)) lanes.value = before
	}

	/** Writes a saved lane back to its profile. */
	async function applyToProfile(lane: Lane) {
		return !!await act(`${base}/models/${lane.id}/apply`, { method: 'POST', success: 'Profile updated' })
	}

	async function setSettings(changes: Partial<ChatSettings>) {
		const before = settings.value
		settings.value = { ...before, ...changes }
		if (base && !await act(base, { method: 'PATCH', body: { settings: settings.value } })) settings.value = before
	}

	return { saved: !!chat, lanes, settings, enabledLanes, adding, laneModel, laneName, laneColor, laneAvatar, draft, fromProfile, add, duplicate, update, remove, move, applyToProfile, setSettings }
}

export type ChatLanes = ReturnType<typeof useChatLanes>
