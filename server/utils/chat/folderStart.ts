import { allows } from 'nuxt-authorization/utils'
// Relative, not `#shared` or `hub:db`, so this module also loads in `bun test`.
import { libraryAbilities } from '../../../shared/abilities/libraryAbilities'
import { profileAbilities } from '../../../shared/abilities/profileAbilities'
import type { User } from '../../../shared/types/db'
import { type FolderDefaults, nearestWithDefaults } from '../../../shared/utils/folderDefaults'
import type { Db } from '../core/settings'
import { findLibrary } from '../library/libraries'
import { assertCharacterUsable } from './characters'
import { listFolders } from './folders'
import { newLaneValues } from './lanes'
import { findStructureProfile } from './structureProfiles'

const usable = (check: Promise<unknown>) => check.then(() => true, () => false)

/**
 * What a chat started in `folderId` begins with, from the folder's defaults or the nearest folder's up the tree, as
 * the member may still use them: libraries they can no longer read, profiles and Characters they can no longer use
 * are skipped. A lane whose profile is gone keeps its own fields, and is dropped when it had none; with no lane left,
 * the chat starts with the default model. Group mode needs two lanes. An unusable "who you are" falls back to the
 * member's own default (`userCharacterId` absent). `null` when the folder is not theirs.
 */
export async function folderStart(db: Db, user: User, folderId: string) {
	const folders = await listFolders(db, user.id)
	const folder = folders.find(entry => entry.id === folderId)
	if (!folder) return null
	const source = nearestWithDefaults(folders, folderId)
	const defaults: FolderDefaults | null = source?.defaults ?? null

	const [libraries, profile, lanes, characterUsable] = await Promise.all([
		Promise.all((defaults?.libraryIds ?? []).map(async (id) => {
			const library = await findLibrary(db, id)
			return library && await allows(libraryAbilities().readLibrary, user, library) ? [library.id] : []
		})),
		defaults?.structureProfileId ? findStructureProfile(db, defaults.structureProfileId) : undefined,
		Promise.all((defaults?.models ?? []).map(async ({ profileId, ...fields }) => {
			const characterId = fields.characterId && !await usable(assertCharacterUsable(db, user.id, fields.characterId)) ? null : fields.characterId
			const own = { ...fields, ...(characterId !== undefined && { characterId }) }
			if (profileId && await usable(newLaneValues(db, user.id, { profileId }))) return [{ profileId, ...own }]
			return profileId && !fields.modelId ? [] : [own]
		})),
		defaults?.userCharacterId ? usable(assertCharacterUsable(db, user.id, defaults.userCharacterId)) : true,
	])
	const models = defaults?.models ? lanes.flat() : undefined
	return {
		folder: { id: folder.id, name: folder.name },
		/** The folder the defaults come from, when it is not this one. */
		from: source && source.id !== folder.id ? { id: source.id, name: source.name } : null,
		defaults: defaults && {
			libraryIds: libraries.flat(),
			structureProfileId: profile && await allows(profileAbilities().readProfile, user, profile) ? profile.id : null,
			...(models && { models: models.length ? models : [{}] }),
			...(defaults.mode && { mode: defaults.mode === 'group' && (models?.length ?? 0) >= 2 ? 'group' as const : 'separate' as const }),
			...(defaults.userCharacterId !== undefined && characterUsable && { userCharacterId: defaults.userCharacterId }),
			...(defaults.settings && { settings: defaults.settings }),
		},
	}
}

export type FolderStart = NonNullable<Awaited<ReturnType<typeof folderStart>>>
