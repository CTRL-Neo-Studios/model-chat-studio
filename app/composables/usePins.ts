export type PinKind = 'chat' | 'chatFolder' | 'modelProfile' | 'library' | 'structureProfile' | 'character'

/**
 * The member's pins: what lists show first. Pinning shows at once and is undone if the server refuses.
 */
export function usePins() {
	const act = useApiAction()
	const queryCache = useQueryCache()
	const { data } = useQuery(pinsQuery)

	const pinned = computed(() => {
		const keys: Record<string, true> = {}
		for (const pin of data.value ?? []) keys[`${pin.kind}:${pin.targetId}`] = true
		return keys
	})
	const isPinned = (kind: PinKind, id: string) => !!pinned.value[`${kind}:${id}`]

	/** Pinned items first, each group in the list's own order. */
	function pinnedFirst<T extends { id: string }>(kind: PinKind, list: T[]): T[] {
		return [...list.filter(item => isPinned(kind, item.id)), ...list.filter(item => !isPinned(kind, item.id))]
	}

	async function togglePin(kind: PinKind, id: string) {
		const pin = !isPinned(kind, id)
		const before = data.value ?? []
		queryCache.setQueryData(pinsQuery.key, pin
			? [...before, { kind, targetId: id }]
			: before.filter(entry => !(entry.kind === kind && entry.targetId === id)))
		if (!await act(`/api/v1/pins/${kind}/${id}`, { method: pin ? 'PUT' : 'DELETE' })) queryCache.setQueryData(pinsQuery.key, before)
	}

	/** A menu item that pins or unpins. */
	const pinItem = (kind: PinKind, id: string) => isPinned(kind, id)
		? { label: 'Unpin', icon: 'i-lucide-pin-off', onSelect: () => togglePin(kind, id) }
		: { label: 'Pin to the top', icon: 'i-lucide-pin', onSelect: () => togglePin(kind, id) }

	return { isPinned, pinnedFirst, togglePin, pinItem }
}
