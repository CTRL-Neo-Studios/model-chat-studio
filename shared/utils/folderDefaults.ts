import { z } from 'zod'

/** What a new chat started in a folder begins with. Ids that no longer resolve (a library left, a profile deleted) are skipped. */
export const folderDefaultsSchema = z.object({
	libraryIds: z.array(z.uuid()).max(5).transform(ids => [...new Set(ids)]),
	structureProfileId: z.uuid().nullable(),
}).strict()

export type FolderDefaults = z.infer<typeof folderDefaultsSchema>

/**
 * The defaults a new chat in `folderId` begins with: the folder's own, else the nearest folder's up the tree that has
 * any; `null` when none has. Bounded by the number of folders, so a cycle left by two concurrent moves cannot loop.
 */
export function nearestDefaults(folders: { id: string, parentId: string | null, defaults: FolderDefaults | null }[], folderId: string | null) {
	const byId = Object.fromEntries(folders.map(folder => [folder.id, folder]))
	let id = folderId
	for (let step = 0; id && step <= folders.length; step++) {
		const folder = byId[id]
		if (!folder) return null
		if (folder.defaults) return folder.defaults
		id = folder.parentId
	}
	return null
}
