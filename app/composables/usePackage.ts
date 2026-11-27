/** One of the member's packages, and its listing once published (from "Your listings", with every version's state). */
export function usePackage(id: MaybeRefOrGetter<string>) {
	const { data: found, error } = useQuery(() => packageQuery(toValue(id)))
	const { data: listings } = useQuery(myListingsQuery)
	const listing = computed(() => found.value?.listingId ? listings.value?.find(entry => entry.id === found.value!.listingId) : undefined)
	return { found, error, listing }
}
