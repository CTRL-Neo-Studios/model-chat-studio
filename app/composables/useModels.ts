/** The active platform and the models this member may pick. Pages `await ready` to have it on the server render. */
export function useModels() {
	// Guests only read shared chats; the catalog needs a member.
	const request = useFetch('/api/v1/models', { key: 'models', immediate: useUserSession().loggedIn.value })

	const platform = computed(() => request.data.value?.platform ?? null)
	const models = computed(() => request.data.value?.models ?? [])
	/** How many models can answer in one chat. */
	const maxChatModels = computed(() => request.data.value?.maxChatModels ?? 4)

	/** The model a chat uses: its own while still offered, else the platform's default. */
	function resolveModel(id?: string) {
		return models.value.find(model => model.id === id)
			?? models.value.find(model => model.id === request.data.value?.defaultModel)
	}

	return { ready: request, platform, models, maxChatModels, resolveModel }
}

export type CatalogModelView = ReturnType<typeof useModels>['models']['value'][number]

/** What the model browser shows; members' and admins' catalogs both fit. */
export type BrowsableModel = Pick<CatalogModelView, 'id' | 'name' | 'vendor' | 'contextLength' | 'maxOutputTokens' | 'inputModalities' | 'outputModalities' | 'pricing'> & {
	/** Speech-to-text models only. */
	pricePerMinute?: number | null
}
