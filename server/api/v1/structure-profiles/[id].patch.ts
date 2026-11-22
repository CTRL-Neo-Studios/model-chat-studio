import { defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { profileAbilities } from '#shared/abilities/profileAbilities'
import { structureProfileFieldsSchema } from '#shared/utils/structureProfile'
import { authorize } from '#server/utils/core/authorize'
import { findStructureProfile } from '#server/utils/chat/structureProfiles'

const bodySchema = structureProfileFieldsSchema.partial().strict()
	.refine(fields => Object.keys(fields).length > 0, 'Nothing to change')

/** Changes a structure profile: the owner's own, or an instance one by an admin. */
export default defineEventHandler(async (event) => {
	const profile = await findStructureProfile(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, profileAbilities().manageProfile, profile)
	const fields = await readValidatedBody(event, bodySchema)
	const [updated] = await db.update(schema.structureProfile).set(fields).where(eq(schema.structureProfile.id, profile!.id)).returning()
	return updated!
})
