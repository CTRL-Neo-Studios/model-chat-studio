import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { assertProfileCharacter } from '#server/utils/chat/characters'
import { db, schema } from 'hub:db'
import { z } from 'zod'
import { profileAbilities } from '#shared/abilities/profileAbilities'
import { profileFieldsSchema } from '#shared/utils/chat'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { findOfferedModel } from '#server/utils/chat/profiles'

const bodySchema = profileFieldsSchema.partial().required({ modelId: true }).extend({
	/** Admins: publish it as an instance profile, which every member can use. */
	instance: z.boolean().optional(),
}).strict()

/** Creates a profile. A model id alone is a quick add, named after the model. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	await authorize(event, profileAbilities().useProfiles)
	const { instance, ...fields } = await readValidatedBody(event, bodySchema)
	if (instance) await authorize(event, profileAbilities().publishProfiles)
	await assertProfileCharacter(db, user.id, fields.characterId, instance ? null : user.id)

	const { platform, model } = await findOfferedModel(db, user.id, fields.modelId)
	const [profile] = await db.insert(schema.modelProfile).values({
		...fields,
		ownerId: instance ? null : user.id,
		name: fields.name ?? model.name,
		systemPrompt: fields.systemPrompt || null,
		platform,
	}).returning()
	return profile!
})
