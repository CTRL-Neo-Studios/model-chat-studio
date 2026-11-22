import type { EditorMentionMenuItem } from '@nuxt/ui'
import { getFileIcon } from '#shared/utils/file'
import type { LibraryRef } from '#shared/utils/librarySpace'

/** The files, notes and folders of a chat's libraries for "@" in the prompt, and the message parts of the ones picked. */
export function useLibraryMentions(libraries: MaybeRefOrGetter<LibraryRef[]>) {
	const space = useLibrarySpace(libraries)
	const byId = computed(() => Object.fromEntries(space.value.map(entry => [entry.id, entry])))

	/** By path, so a library's entries, and a folder and what is in it, sit together. The menu inserts `@path` and keeps the entry id. */
	const items = computed<EditorMentionMenuItem[]>(() => space.value
		.map(entry => ({
			id: entry.id,
			label: entry.path,
			icon: entry.kind === 'folder' ? 'i-lucide-folder' : entry.kind === 'note' ? 'i-lucide-notebook-pen' : getFileIcon(entry.mediaType ?? ''),
			description: entry.kind === 'folder' ? 'everything inside' : undefined,
		}))
		.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })))

	/** The `data-reference` parts for the entries named in the prompt; ones gone since are skipped. */
	const partsFor = (ids: string[]) => ids.flatMap((id) => {
		const entry = byId.value[id]
		return entry ? [{ type: 'data-reference' as const, data: { entryId: entry.id, name: entry.path, kind: entry.kind } }] : []
	})

	return { items, partsFor }
}
