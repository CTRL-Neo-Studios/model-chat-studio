import type { DropdownMenuItem } from '@nuxt/ui'
import { LazyModalConfirm, LazyModalListingUpdate, LazyModalPublishListing } from '#components'
import type { PackageSource } from '#shared/utils/package'
import type { ListingTextsDraft } from '~/components/ModalPublishListing.vue'

/** A listing as `/me/listings` returns it, as far as its actions and its state need. */
interface OwnListing extends ListingTextsDraft {
	id: string
	status: 'listed' | 'unlisted' | 'removed'
	source: PackageSource
	/** The number of the version on Explore, if one was approved. */
	version: number | null
	versions: { number: number, status: 'approved' | 'pending' | 'rejected', reason: string | null }[]
}

/** Where a listing stands for its publisher: its status, or, until a version is approved, its review. */
export function listingState(listing: Pick<OwnListing, 'status' | 'version' | 'versions'>): { label: string, color: 'success' | 'neutral' | 'error' | 'info' } {
	if (listing.status === 'removed') return { label: 'Removed', color: 'error' }
	if (!listing.version) return listing.versions[0]?.status === 'rejected' ? { label: 'Rejected', color: 'error' } : { label: 'Waiting for review', color: 'info' }
	return listing.status === 'listed' ? { label: 'Published', color: 'success' } : { label: 'Unpublished', color: 'neutral' }
}

/** An item's ids (or a folder's) as one string, to find the listing published from exactly them. */
const sourceKey = (source: PackageSource) => [source.folderId ?? '', ...source.characterIds ?? [], ...source.libraryIds ?? [], ...source.structureProfileIds ?? []].join()

/** The member's listings, and the one published from an item alone (or a folder's setup): the newest, if there are two. */
export function useMyListings() {
	const { data } = useQuery(myListingsQuery)
	const listingOf = (source: PackageSource) => data.value?.find(listing => sourceKey(listing.source) === sourceKey(source))
	return { listingOf }
}

/** Publishing to Explore and the publisher's actions on their listings, each through its dialog. */
export function useListingActions() {
	const overlay = useOverlay()
	const act = useApiAction()
	const toast = useToast()
	const queryCache = useQueryCache()
	const { listingOf } = useMyListings()
	const publishModal = overlay.create(LazyModalPublishListing)
	const updateModal = overlay.create(LazyModalListingUpdate)
	const confirm = overlay.create(LazyModalConfirm)
	// The publisher's list, and what Explore shows (the grid, the listing's page, the counts).
	const refresh = () => Promise.all([queryCache.invalidateQueries({ key: myListingsQuery.key }), queryCache.invalidateQueries({ key: ['explore'] })])
	const yours = [{ label: 'Your listings', to: '/content/published' }]

	/** "Publish to Explore…": the texts, what it holds and leaves out, then a new listing. */
	async function publish(source: PackageSource, name: string) {
		const texts = await publishModal.open({ heading: 'Publish to Explore', texts: { name: name.slice(0, 80), summary: '', description: '', tags: [], category: null }, source }).result
		if (!texts) return
		const published = await act<{ left: string[], pending: boolean }>('/api/v1/explore/listings', { method: 'POST', body: { ...texts, source } })
		if (!published) return
		toast.add({ title: published.pending ? 'Sent for review' : 'Published to Explore', description: [published.pending ? 'It shows on Explore once an admin or moderator approves it.' : '', ...published.left].join(' ').trim() || undefined, icon: 'i-lucide-telescope', color: 'success', actions: yours })
		await refresh()
	}

	async function edit(listing: OwnListing) {
		const { name, summary, description, tags, category } = listing
		const texts = await publishModal.open({ heading: 'Edit listing', texts: { name, summary, description, tags, category } }).result
		if (!texts) return
		if (await act(`/api/v1/explore/listings/${listing.id}`, { method: 'PATCH', body: { ...texts }, success: 'Listing saved' })) await refresh()
	}

	/** "Publish an update", or "Publish again" after a rejection: a new version from the items the listing was published from. */
	async function update(listing: OwnListing, again = false) {
		const notes = await updateModal.open({ name: listing.name, source: listing.source, again }).result
		if (!notes) return
		const updated = await act<{ left: string[], pending: boolean }>(`/api/v1/explore/listings/${listing.id}/versions`, { method: 'POST', body: { notes } })
		if (!updated) return
		toast.add({ title: updated.pending ? 'Sent for review' : 'Update published', description: updated.left.join(' ') || undefined, icon: 'i-lucide-telescope', color: 'success' })
		await refresh()
	}

	/** "Unpublish" takes it off Explore and keeps everything; "Put back on Explore" shows it again as it was, without review. */
	async function setPublished(listing: Pick<OwnListing, 'id'>, published: boolean) {
		if (await act(`/api/v1/explore/listings/${listing.id}`, { method: 'PATCH', body: { status: published ? 'listed' : 'unlisted' }, success: published ? 'Back on Explore' : 'Unpublished: only you see it' })) await refresh()
	}

	async function remove(listing: OwnListing) {
		if (!await confirm.open({ title: `Delete “${listing.name}”?`, description: 'It leaves Explore with all its versions. Copies people got stay theirs.' }).result) return
		if (await act(`/api/v1/explore/listings/${listing.id}`, { method: 'DELETE', success: 'Listing deleted' })) await refresh()
	}

	/**
	 * The publisher's actions on a listing: its texts, a new version (an update, or again after a rejection; none while
	 * one waits), and unpublishing or putting back. None once a moderator removed it: it can only be deleted.
	 */
	function listingActions(listing: OwnListing): DropdownMenuItem[] {
		if (listing.status === 'removed') return []
		const newest = listing.versions[0]?.status
		return [
			{ label: 'Edit listing…', icon: 'i-lucide-pencil', onSelect: () => edit(listing) },
			...(newest === 'pending'
				? []
				: newest === 'rejected'
					? [{ label: 'Publish again…', icon: 'i-lucide-telescope', onSelect: () => update(listing, true) }]
					: [{ label: 'Publish an update…', icon: 'i-lucide-telescope', onSelect: () => update(listing) }]),
			listing.status === 'listed'
				? { label: 'Unpublish', icon: 'i-lucide-eye-off', onSelect: () => setPublished(listing, false) }
				: { label: 'Put back on Explore', icon: 'i-lucide-eye', onSelect: () => setPublished(listing, true) },
		]
	}

	/** An item's menu entries for Explore: "Publish to Explore…", or once it is published, its listing and what can be done with it. */
	function publishActions(source: PackageSource, name: string): DropdownMenuItem[] {
		const listing = listingOf(source)
		if (!listing) return [{ label: 'Publish to Explore…', icon: 'i-lucide-telescope', onSelect: () => publish(source, name) }]
		return [{ label: 'Open on Explore', icon: 'i-lucide-telescope', to: `/content/explore/${listing.id}` }, ...listingActions(listing)]
	}

	return { publish, update, setPublished, remove, listingActions, publishActions }
}
