import type { PiniaColadaOptions } from '@pinia/colada'

export default {
	queryOptions: {
		// A page seen within 30 s shows its data as is; older data shows at once and refreshes behind it.
		staleTime: 30_000,
		// Data no page uses is kept 10 minutes, so going back to a page is instant.
		gcTime: 10 * 60_000,
		// A failed request during server rendering leaves the query in its error state, as in the browser.
		ssrCatchError: true,
	},
} satisfies PiniaColadaOptions
