import type { EditorMentionMenuItem } from '@nuxt/ui'
import { getFileIcon } from '#shared/utils/file'

/** A library's files, notes and folders for "@" in the prompt, and the message parts of the ones picked. */
export function useLibraryMentions(libraryId: MaybeRefOrGetter<string | null | undefined>) {
	const { data } = useQuery(() => ({ ...libraryEntriesQuery(toValue(libraryId) ?? ''), enabled: !!toValue(libraryId) }))
	const entries = computed(() => toValue(libraryId) ? data.value ?? [] : [])
	type Entry = (typeof entries.value)[number]

	const byId = computed<Record<string, Entry>>(() => Object.fromEntries(entries.value.map(entry => [entry.id, entry])))
	const pathOf = (entry: Entry, depth = 0): string => {
		const parent = entry.parentId ? byId.value[entry.parentId] : undefined
		return parent && depth < entries.value.length ? `${pathOf(parent, depth + 1)}/${entry.name}` : entry.name
	}

	/** By path, so a folder and what is in it sit together. The menu inserts `@path` and keeps the entry id. */
	const items = computed<EditorMentionMenuItem[]>(() => entries.value
		.map(entry => ({
			id: entry.id,
			label: pathOf(entry),
			icon: entry.kind === 'folder' ? 'i-lucide-folder' : entry.kind === 'note' ? 'i-lucide-notebook-pen' : getFileIcon(entry.mediaType ?? ''),
			description: entry.kind === 'folder' ? 'everything inside' : undefined,
		}))
		.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })))

	/** The `data-reference` parts for the entries named in the prompt; ones deleted since are skipped. */
	const partsFor = (ids: string[]) => ids.flatMap((id) => {
		const entry = byId.value[id]
		return entry ? [{ type: 'data-reference' as const, data: { entryId: entry.id, name: pathOf(entry), kind: entry.kind } }] : []
	})

	return { items, partsFor }
}
