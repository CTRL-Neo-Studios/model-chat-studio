import type { PiniaColadaOptions } from '@pinia/colada'

export default {
	queryOptions: {
		// A page seen within 30 s shows its data as is; older data shows at once and refreshes behind it.
		staleTime: 30_000,
		// Data no page uses is kept an hour, so going back to a page, or to one loaded in the background, is instant.
		gcTime: 60 * 60_000,
		// A failed request leaves the query in its error state, as in the browser.
		ssrCatchError: true,
		// Data loads in the browser: the server sends the page at once, with its skeletons, instead of waiting for
		// every query. Pages that arrive with their data (a chat, a library) set `enabled: true` on their own query;
		// any other query with its own `enabled` must keep `import.meta.client`.
		enabled: () => import.meta.client,
	},
} satisfies PiniaColadaOptions
