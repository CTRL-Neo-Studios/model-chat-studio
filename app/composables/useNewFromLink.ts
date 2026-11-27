/**
 * "New…" elsewhere (the Content page) links to a list with `?new`: the list opens its "new" dialog once, and the
 * address drops `new` so a reload does not open it again.
 */
export function useNewFromLink(create: () => unknown) {
	const route = useRoute()
	onMounted(async () => {
		if (route.query.new === undefined) return
		const { new: _new, ...query } = route.query
		await navigateTo({ query }, { replace: true })
		create()
	})
}
