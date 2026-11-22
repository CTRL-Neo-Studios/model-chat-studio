import { defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { profileAbilities } from '#shared/abilities/profileAbilities'
import { contextProfileFieldsSchema } from '#shared/utils/contextProfile'
import { authorize } from '#server/utils/core/authorize'
import { findContextProfile } from '#server/utils/project/contextProfiles'

const bodySchema = contextProfileFieldsSchema.partial().strict()
	.refine(fields => Object.keys(fields).length > 0, 'Nothing to change')

/** Changes a context profile: the owner's own, or an instance one by an admin. */
export default defineEventHandler(async (event) => {
	const profile = await findContextProfile(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, profileAbilities().manageProfile, profile)
	const fields = await readValidatedBody(event, bodySchema)
	const [updated] = await db.update(schema.contextProfile).set(fields).where(eq(schema.contextProfile.id, profile!.id)).returning()
	return updated!
})
