import { LazyModalStarLists } from '#components'

/** "Add to a list…": opens the lists dialog for a listing and puts it in or takes it out of each list chosen. */
export function useStarLists() {
	const overlay = useOverlay()
	const act = useApiAction()
	const queryCache = useQueryCache()
	const modal = overlay.create(LazyModalStarLists)

	async function addToLists(listingId: string, name: string) {
		const lists = await $fetch('/api/v1/me/stars')
		const selected = lists.lists.filter(list => list.listingIds.includes(listingId)).map(list => list.id)
		const result = await modal.open({ name, lists: lists.lists, selected }).result
		if (!result) return
		const made = await Promise.all(result.created.map(listName => act<{ id: string }>('/api/v1/me/star-lists', { method: 'POST', body: { name: listName } })))
		const wanted = [...result.selected, ...made.flatMap(list => list ? [list.id] : [])]
		const changes = [
			...wanted.filter(id => !selected.includes(id)).map(id => act(`/api/v1/me/star-lists/${id}/listings/${listingId}`, { method: 'PUT' })),
			...selected.filter(id => !wanted.includes(id)).map(id => act(`/api/v1/me/star-lists/${id}/listings/${listingId}`, { method: 'DELETE' })),
		]
		await Promise.all(changes)
		await Promise.all([queryCache.invalidateQueries({ key: myStarsQuery.key }), queryCache.invalidateQueries({ key: ['explore'] })])
	}

	return { addToLists }
}
