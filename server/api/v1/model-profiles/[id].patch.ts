import { defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { profileAbilities } from '#shared/abilities/profileAbilities'
import { profileFieldsSchema } from '#shared/utils/chat'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { findModelProfile, findOfferedModel } from '#server/utils/chat/profiles'

const bodySchema = profileFieldsSchema.partial().strict()
	.refine(fields => Object.keys(fields).length > 0, 'Nothing to change')

/** Changes a profile: the owner's own, or an instance profile by an admin. Lanes started from it keep their copy. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const profile = await findModelProfile(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, profileAbilities().manageProfile, profile)
	const fields = await readValidatedBody(event, bodySchema)

	const [updated] = await db.update(schema.modelProfile).set({
		...fields,
		...(fields.systemPrompt !== undefined && { systemPrompt: fields.systemPrompt || null }),
		...(fields.modelId && { platform: (await findOfferedModel(db, user.id, fields.modelId)).platform }),
	}).where(eq(schema.modelProfile.id, profile!.id)).returning()
	return updated!
})
