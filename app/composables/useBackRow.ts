/**
 * The back row of a thing's sidebar: to its list, or, when it was opened from a package's Items (`?package=`), back
 * to that package.
 */
export function useBackRow(list: { label: string, to: string }) {
	const route = useRoute()
	const packageId = computed(() => typeof route.query.package === 'string' ? route.query.package : undefined)
	const { data: packages } = useQuery(() => ({ ...packagesQuery, enabled: import.meta.client && !!packageId.value }))
	return computed(() => {
		if (!packageId.value) return { ...list, icon: 'i-lucide-arrow-left' }
		const name = packages.value?.find(entry => entry.id === packageId.value)?.name
		return { label: name ?? 'Package', to: `/content/packages/${packageId.value}/items`, icon: 'i-lucide-arrow-left' }
	})
}
