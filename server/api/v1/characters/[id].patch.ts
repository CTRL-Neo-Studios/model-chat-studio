import { defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { libraryAbilities } from '#shared/abilities/libraryAbilities'
import { profileAbilities } from '#shared/abilities/profileAbilities'
import { characterFieldsSchema } from '#shared/utils/character'
import { authorize } from '#server/utils/core/authorize'
import { findCharacter, setCharacterLibraries } from '#server/utils/chat/characters'
import { findLibrary } from '#server/utils/library/libraries'

const bodySchema = characterFieldsSchema.partial().strict()
	.refine(fields => Object.keys(fields).length > 0, 'Nothing to change')

/** Changes a Character: the owner's own, or an instance one by an admin. Every chat it is in follows at once. */
export default defineEventHandler(async (event) => {
	const found = await findCharacter(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, profileAbilities().manageProfile, found)
	const { libraryIds, ...fields } = await readValidatedBody(event, bodySchema)
	if (libraryIds) {
		// Libraries it keeps need no new check; ones added must be readable by whoever adds them.
		for (const libraryId of libraryIds.filter(id => !found!.libraryIds.includes(id))) await authorize(event, libraryAbilities().readLibrary, await findLibrary(db, libraryId))
		await setCharacterLibraries(db, found!.id, libraryIds)
	}
	// `updatedAt` keeps the update non-empty when only the libraries change.
	await db.update(schema.character).set({ ...fields, updatedAt: new Date() }).where(eq(schema.character.id, found!.id))
	return (await findCharacter(db, found!.id))!
})
