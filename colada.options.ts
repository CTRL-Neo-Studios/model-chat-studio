import type { PiniaColadaOptions } from '@pinia/colada'

export default {
	queryOptions: {
		// A page seen within 30 s shows its data as is; older data shows at once and refreshes behind it.
		staleTime: 30_000,
		// Data no page uses is kept 10 minutes, so going back to a page is instant.
		gcTime: 10 * 60_000,
		// A failed request leaves the query in its error state, as in the browser.
		ssrCatchError: true,
		// Data loads in the browser: the server sends the page at once, with its skeletons, instead of waiting for
		// every query (2 to 3.5 s on a reload with the dev database). A query with its own `enabled` must keep this.
		enabled: () => import.meta.client,
	},
} satisfies PiniaColadaOptions
