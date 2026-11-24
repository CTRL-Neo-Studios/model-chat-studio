import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { z } from 'zod'
import { libraryAbilities } from '#shared/abilities/libraryAbilities'
import { profileAbilities } from '#shared/abilities/profileAbilities'
import { characterFieldsSchema } from '#shared/utils/character'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { findCharacter, setCharacterLibraries } from '#server/utils/chat/characters'
import { findLibrary } from '#server/utils/library/libraries'

const bodySchema = characterFieldsSchema.partial().required({ name: true }).extend({
	/** Admins: publish it as an instance Character, which every member can use. */
	instance: z.boolean().optional(),
}).strict()

/** Creates a Character, the member's own or (admins) an instance one. Its libraries must be ones the member reads. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	await authorize(event, profileAbilities().useProfiles)
	const { instance, libraryIds = [], ...fields } = await readValidatedBody(event, bodySchema)
	if (instance) await authorize(event, profileAbilities().publishProfiles)
	for (const libraryId of libraryIds) await authorize(event, libraryAbilities().readLibrary, await findLibrary(db, libraryId))

	const [created] = await db.insert(schema.character).values({ ...fields, ownerId: instance ? null : user.id }).returning()
	await setCharacterLibraries(db, created!.id, libraryIds)
	return (await findCharacter(db, created!.id))!
})
