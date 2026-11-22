/** The active platform and the models this member may pick, from the shared `models` query. */
export function useModels() {
	// Guests only read shared chats; the catalog needs a member.
	const { loggedIn } = useUserSession()
	const { data, isPending } = useQuery(() => ({ ...modelsQuery, enabled: import.meta.client && loggedIn.value }))

	const platform = computed(() => data.value?.platform ?? null)
	const models = computed(() => data.value?.models ?? [])
	/** How many models can answer in one chat. */
	const maxChatModels = computed(() => data.value?.maxChatModels ?? 4)

	/** The model a chat uses: its own while still offered, else the platform's default. */
	function resolveModel(id?: string) {
		return models.value.find(model => model.id === id)
			?? models.value.find(model => model.id === data.value?.defaultModel)
	}

	return { isPending, platform, models, maxChatModels, resolveModel }
}

export type CatalogModelView = ReturnType<typeof useModels>['models']['value'][number]

/** What the model browser shows; members' and admins' catalogs both fit. */
export type BrowsableModel = Pick<CatalogModelView, 'id' | 'name' | 'vendor' | 'contextLength' | 'maxOutputTokens' | 'inputModalities' | 'outputModalities' | 'pricing'> & {
	/** Speech-to-text models only. */
	pricePerMinute?: number | null
}
