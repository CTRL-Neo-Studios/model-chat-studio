import { LazyModalConfirm, LazyModalListingUpdate, LazyModalPublishListing } from '#components'
import type { PackageSource } from '#shared/utils/package'
import type { ListingTextsDraft } from '~/components/ModalPublishListing.vue'

/** A listing as `/me/listings` returns it, as far as its actions need. */
interface OwnListing extends ListingTextsDraft {
	id: string
	status: 'listed' | 'unlisted' | 'removed'
	source: PackageSource
}

/** Publishing to Explore and the publisher's actions on their listings, each through its dialog. */
export function useListingActions() {
	const overlay = useOverlay()
	const act = useApiAction()
	const toast = useToast()
	const queryCache = useQueryCache()
	const publishModal = overlay.create(LazyModalPublishListing)
	const updateModal = overlay.create(LazyModalListingUpdate)
	const confirm = overlay.create(LazyModalConfirm)
	const refresh = () => queryCache.invalidateQueries({ key: myListingsQuery.key })
	const yours = [{ label: 'Your listings', to: '/explore/mine' }]

	/** "Publish to Explore…": the texts, what it holds and leaves out, then a new listing. */
	async function publish(source: PackageSource, name: string) {
		const texts = await publishModal.open({ heading: 'Publish to Explore', texts: { name: name.slice(0, 80), summary: '', description: '', tags: [], category: null }, source }).result
		if (!texts) return
		const published = await act<{ left: string[] }>('/api/v1/explore/listings', { method: 'POST', body: { ...texts, source } })
		if (!published) return
		toast.add({ title: 'Published to Explore', description: published.left.join(' ') || undefined, icon: 'i-lucide-telescope', color: 'success', actions: yours })
		await refresh()
	}

	async function edit(listing: OwnListing) {
		const { name, summary, description, tags, category } = listing
		const texts = await publishModal.open({ heading: 'Edit listing', texts: { name, summary, description, tags, category } }).result
		if (!texts) return
		if (await act(`/api/v1/explore/listings/${listing.id}`, { method: 'PATCH', body: { ...texts }, success: 'Listing saved' })) await refresh()
	}

	/** "Publish an update": a new version from the items the listing was published from. */
	async function update(listing: OwnListing) {
		const notes = await updateModal.open({ name: listing.name, source: listing.source }).result
		if (!notes) return
		const updated = await act<{ left: string[] }>(`/api/v1/explore/listings/${listing.id}/versions`, { method: 'POST', body: { notes } })
		if (!updated) return
		toast.add({ title: 'Update published', description: updated.left.join(' ') || undefined, icon: 'i-lucide-telescope', color: 'success' })
		await refresh()
	}

	async function setListed(listing: OwnListing, listed: boolean) {
		if (await act(`/api/v1/explore/listings/${listing.id}`, { method: 'PATCH', body: { status: listed ? 'listed' : 'unlisted' }, success: listed ? 'Listed on Explore' : 'Unlisted: only you see it' })) await refresh()
	}

	async function remove(listing: OwnListing) {
		if (!await confirm.open({ title: `Delete “${listing.name}”?`, description: 'It leaves Explore with all its versions. Copies people got stay theirs.' }).result) return
		if (await act(`/api/v1/explore/listings/${listing.id}`, { method: 'DELETE', success: 'Listing deleted' })) await refresh()
	}

	return { publish, edit, update, setListed, remove }
}
