/**
 * Server data for Pinia Colada, one definition per resource. Every component using a key shares one cache entry:
 * a page seen before renders from it at once and refreshes behind it when stale. Changes write into the cache
 * (`setQueryData`) or invalidate a key.
 *
 * `useRequestFetch()` forwards the visitor's cookie while rendering on the server; in the browser it is `$fetch`.
 */

const FIVE_MINUTES = 5 * 60_000

export const chatsQuery = defineQueryOptions({
	key: ['chats'],
	query: () => useRequestFetch()('/api/v1/chats'),
})

/** Other people's chats shared with the member by name. Under `/me`: beside `/chats/:id` its path made every chat route's type a union. */
export const sharedChatsQuery = defineQueryOptions({
	key: ['shared-chats'],
	query: () => useRequestFetch()('/api/v1/me/shared-chats'),
})

/** The member's own Characters and the instance ones, each with its `libraryIds`. */
export const charactersQuery = defineQueryOptions({
	key: ['characters'],
	query: () => useRequestFetch()('/api/v1/characters'),
})

export const foldersQuery = defineQueryOptions({
	key: ['folders'],
	query: () => useRequestFetch()('/api/v1/folders'),
})

/** What a new chat in a folder starts with, as the server resolves the folder's defaults for this member. */
export const folderStartQuery = defineQueryOptions((id: string) => ({
	key: ['folders', id, 'start'],
	query: () => useRequestFetch()(`/api/v1/folders/${id}/start`),
	// It depends on profiles, Characters and libraries that change elsewhere: read it again on each visit.
	staleTime: 0,
}))

export const pinsQuery = defineQueryOptions({
	key: ['pins'],
	query: () => useRequestFetch()('/api/v1/pins'),
})

export const chatQuery = defineQueryOptions((id: string) => ({
	key: ['chats', id],
	query: () => useRequestFetch()(`/api/v1/chats/${id}`),
}))

export const chatVotesQuery = defineQueryOptions((id: string) => ({
	key: ['chats', id, 'votes'],
	query: () => useRequestFetch()(`/api/v1/chats/${id}/votes`),
}))

/** Owner only: context blocks per answer, the chat's files and its ledger totals. */
export const chatOverviewQuery = defineQueryOptions((id: string) => ({
	key: ['chats', id, 'overview'],
	query: () => useRequestFetch()(`/api/v1/chats/${id}/overview`),
	// New answers add traces and spend: read afresh each time the overview opens.
	staleTime: 0,
}))

export const meQuery = defineQueryOptions({
	key: ['me'],
	query: () => useRequestFetch()('/api/v1/users/me'),
})

/** Read-aloud on the active platform: whether it is set up, its voices and the member's. */
export const speechVoicesQuery = defineQueryOptions({
	key: ['speech', 'voices'],
	query: () => useRequestFetch()('/api/v1/speech/voices'),
	staleTime: FIVE_MINUTES,
})

export const usageQuery = defineQueryOptions({
	key: ['me', 'usage'],
	query: () => useRequestFetch()('/api/v1/me/usage'),
})

/** The member's own listings on Explore, whatever their status. */
export const myListingsQuery = defineQueryOptions({
	key: ['me', 'listings'],
	query: () => useRequestFetch()('/api/v1/me/listings'),
})

/** Explore's settings: whether members may publish, the categories and the size limit. */
export const exploreSettingsQuery = defineQueryOptions({
	key: ['explore', 'settings'],
	query: () => useRequestFetch()('/api/v1/explore/settings'),
})

/** Explore's grid for a search, filters, sort and page. */
export const exploreListingsQuery = defineQueryOptions((params: { q?: string, kind?: string, category?: string, tag?: string, sort: string, page: number }) => ({
	key: ['explore', 'listings', params],
	query: () => useRequestFetch()('/api/v1/explore/listings', { query: params }),
}))

/**
 * A listing's page: everything in its current version (or, for its publisher and admins and moderators, `version`),
 * its versions, and which one the member has.
 */
export const exploreListingQuery = defineQueryOptions(({ id, version }: { id: string, version?: string }) => ({
	key: ['explore', 'listing', id, version ?? 'current'],
	query: () => useRequestFetch()(`/api/v1/explore/listings/${id}`, { query: version ? { version } : {} }),
}))

/** Admins and moderators: what waits for review. Under `explore`, so a decision anywhere refreshes it. */
export const exploreReviewsQuery = defineQueryOptions({
	key: ['explore', 'reviews'],
	query: () => useRequestFetch()('/api/v1/explore/reviews'),
})

/** The counts beside "Explore": the member's listings rejected or removed; for reviewers, what waits for them. */
export const exploreCountsQuery = defineQueryOptions({
	key: ['explore', 'counts'],
	query: () => useRequestFetch()('/api/v1/me/explore-counts'),
})

/** Admins and moderators: every listing, whatever its status. */
export const adminListingsQuery = defineQueryOptions({
	key: ['admin', 'listings'],
	query: () => useRequestFetch()('/api/v1/admin/listings'),
})

/** The member's Content Packages, each with the items it still has. */
export const packagesQuery = defineQueryOptions({
	key: ['packages'],
	query: () => useRequestFetch()('/api/v1/packages'),
})

/** One of the member's packages. */
export const packageQuery = defineQueryOptions((id: string) => ({
	key: ['packages', id],
	query: () => useRequestFetch()(`/api/v1/packages/${id}`),
}))

/** The member's starred listings and their star lists. */
export const myStarsQuery = defineQueryOptions({
	key: ['me', 'stars'],
	query: () => useRequestFetch()('/api/v1/me/stars'),
})

export const modelProfilesQuery = defineQueryOptions({
	key: ['model-profiles'],
	query: () => useRequestFetch()('/api/v1/model-profiles'),
})

export const structureProfilesQuery = defineQueryOptions({
	key: ['structure-profiles'],
	query: () => useRequestFetch()('/api/v1/structure-profiles'),
})

export const librariesQuery = defineQueryOptions({
	key: ['libraries'],
	query: () => useRequestFetch()('/api/v1/libraries'),
})

export const libraryQuery = defineQueryOptions((id: string) => ({
	key: ['libraries', id],
	query: () => useRequestFetch()(`/api/v1/libraries/${id}`),
}))

/** The library's files as a flat list, without note text. */
export const libraryEntriesQuery = defineQueryOptions((id: string) => ({
	key: ['libraries', id, 'entries'],
	query: () => useRequestFetch()(`/api/v1/libraries/${id}/entries`),
}))

/** One entry with a note's text. */
export const libraryEntryQuery = defineQueryOptions(({ libraryId, entryId }: { libraryId: string, entryId: string }) => ({
	key: ['libraries', libraryId, 'entries', entryId],
	query: () => useRequestFetch()(`/api/v1/libraries/${libraryId}/entries/${entryId}`),
}))

/** The library's owner and people, with their roles. */
export const libraryMembersQuery = defineQueryOptions((id: string) => ({
	key: ['libraries', id, 'members'],
	query: () => useRequestFetch()(`/api/v1/libraries/${id}/members`),
}))

/** The server caches the platform's catalog for an hour. */
export const modelsQuery = defineQueryOptions({
	key: ['models'],
	query: () => useRequestFetch()('/api/v1/models'),
	staleTime: FIVE_MINUTES,
})

export const endpointsQuery = defineQueryOptions((modelId: string) => ({
	key: ['models', modelId, 'endpoints'],
	query: () => useRequestFetch()('/api/v1/models/endpoints', { query: { id: modelId } }),
	staleTime: FIVE_MINUTES,
}))

export const adminSettingsQuery = defineQueryOptions({
	key: ['admin', 'settings'],
	query: () => useRequestFetch()('/api/v1/admin/settings'),
})

/** A platform's catalog with its instance key; without `platform`, the active one's. */
export const adminCatalogQuery = defineQueryOptions(({ platform, kind = 'chat' }: { platform?: 'openrouter' | 'deepseek', kind?: 'chat' | 'stt' | 'decisions' | 'speech' | 'images' }) => ({
	key: ['admin', 'catalog', platform ?? 'active', kind],
	query: () => useRequestFetch()('/api/v1/admin/models', { query: { platform, kind } }),
	staleTime: FIVE_MINUTES,
}))

export const usersQuery = defineQueryOptions({
	key: ['admin', 'users'],
	query: () => useRequestFetch()('/api/v1/users'),
})

export const invitesQuery = defineQueryOptions({
	key: ['admin', 'invites'],
	query: () => useRequestFetch()('/api/v1/admin/invites'),
})
