/** Loads data the member is about to need, unless it is cached and fresh. Failures wait for the page to show them. */
export function usePrefetch() {
	const queryCache = useQueryCache()
	return (...queries: Parameters<typeof queryCache.ensure>[0][]) => {
		for (const options of queries) queryCache.refresh(queryCache.ensure(options)).catch(() => {})
	}
}
