import { createError, defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { assertFolderParent, folderColumns, folderNameSchema, listFolders } from '#server/utils/chat/folders'
import { folderDefaultsSchema } from '#shared/utils/folderDefaults'
import { libraryAbilities } from '#shared/abilities/libraryAbilities'
import { profileAbilities } from '#shared/abilities/profileAbilities'
import { authorize } from '#server/utils/core/authorize'
import { findLibrary } from '#server/utils/library/libraries'
import { findStructureProfile } from '#server/utils/chat/structureProfiles'
import { newLaneValues } from '#server/utils/chat/lanes'
import { assertCharacterUsable } from '#server/utils/chat/characters'

const bodySchema = z.object({
	name: folderNameSchema,
	/** `null` moves the folder to the top level. */
	parentId: z.uuid().nullable(),
	/** What new chats started in it begin with; `null`: none (a folder above may still have some). */
	defaults: folderDefaultsSchema.nullable(),
}).partial().strict()
	.refine(fields => Object.keys(fields).length > 0, 'Nothing to change')

/** Renames, moves or sets the defaults of one of the member's folders; a move into itself or a folder inside it is refused. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const id = getRouterParam(event, 'id', { decode: true })
	const fields = await readValidatedBody(event, bodySchema)
	const folders = await listFolders(db, user.id)
	const folder = folders.find(entry => entry.id === id)
	if (!folder) throw createError({ status: 404, statusText: 'Folder not found' })
	if (fields.parentId !== undefined) assertFolderParent(folders, fields.parentId, id)
	// Defaults name only what the member may use now; later losses are skipped when a chat starts (`folderStart`).
	for (const libraryId of fields.defaults?.libraryIds ?? []) await authorize(event, libraryAbilities().readLibrary, await findLibrary(db, libraryId))
	if (fields.defaults?.structureProfileId) await authorize(event, profileAbilities().readProfile, await findStructureProfile(db, fields.defaults.structureProfileId))
	for (const lane of fields.defaults?.models ?? []) await newLaneValues(db, user.id, lane)
	await assertCharacterUsable(db, user.id, fields.defaults?.userCharacterId)

	const [updated] = await db.update(schema.chatFolder).set(fields).where(eq(schema.chatFolder.id, id!)).returning(folderColumns)
	return updated!
})
