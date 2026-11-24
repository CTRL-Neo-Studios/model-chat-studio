import { type LibraryRef, spaceEntries } from '#shared/utils/librarySpace'

/**
 * The files, notes and folders of a chat's libraries, each with its path as the model sees it: prefixed with its
 * library's name when there are several. Each library's list is the one its page uses, so changes there show here.
 */
export function useLibrarySpace(libraries: MaybeRefOrGetter<LibraryRef[]>) {
	const queryCache = useQueryCache()
	const entries = computed(() => toValue(libraries).map(library => queryCache.ensure(libraryEntriesQuery(library.id))))
	// Each list loads once it is needed, unless it is cached and fresh.
	if (import.meta.client) watch(entries, list => list.forEach(entry => queryCache.refresh(entry).catch(() => {})), { immediate: true })
	return computed(() => spaceEntries(toValue(libraries), entries.value.map(entry => entry.state.value.data ?? [])))
}
