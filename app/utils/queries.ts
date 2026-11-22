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

export const usageQuery = defineQueryOptions({
	key: ['me', 'usage'],
	query: () => useRequestFetch()('/api/v1/me/usage'),
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
export const adminCatalogQuery = defineQueryOptions(({ platform, kind = 'chat' }: { platform?: 'openrouter' | 'deepseek', kind?: 'chat' | 'stt' }) => ({
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
