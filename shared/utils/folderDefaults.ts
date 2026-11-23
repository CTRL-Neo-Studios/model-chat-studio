import { z } from 'zod'
import { chatSettingsSchema, newLaneSchema } from './chat'

/**
 * What a new chat started in a folder begins with. Everything is optional: a folder without defaults starts chats as
 * the home page does. What no longer resolves when a chat starts (a library left, a profile or Character deleted or no
 * longer usable) is skipped.
 */
export const folderDefaultsSchema = z.object({
	libraryIds: z.array(z.uuid()).max(5).transform(ids => [...new Set(ids)]),
	structureProfileId: z.uuid().nullable(),
	/** The models, in order: a profile to start from and/or lane fields, as `POST /chats` takes them. */
	models: z.array(newLaneSchema).min(1).max(12).optional(),
	mode: z.enum(['separate', 'group']).optional(),
	/** Who the member is: a Character, or `null` for nobody. Absent: their own default from Settings. */
	userCharacterId: z.uuid().nullable().optional(),
	settings: chatSettingsSchema.optional(),
}).strict()

export type FolderDefaults = z.infer<typeof folderDefaultsSchema>

/**
 * The folder whose defaults a new chat in `folderId` begins with: that folder if it has defaults, else the nearest
 * folder up the tree that has any; `null` when none has. Bounded by the number of folders, so a cycle left by two
 * concurrent moves cannot loop.
 */
export function nearestWithDefaults<F extends { id: string, parentId: string | null, defaults: FolderDefaults | null }>(folders: F[], folderId: string | null) {
	const byId = Object.fromEntries(folders.map(folder => [folder.id, folder]))
	let id = folderId
	for (let step = 0; id && step <= folders.length; step++) {
		const folder = byId[id]
		if (!folder) return null
		if (folder.defaults) return folder as F & { defaults: FolderDefaults }
		id = folder.parentId
	}
	return null
}
