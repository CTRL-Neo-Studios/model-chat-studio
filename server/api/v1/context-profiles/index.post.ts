import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { z } from 'zod'
import { profileAbilities } from '#shared/abilities/profileAbilities'
import { contextProfileFieldsSchema } from '#shared/utils/contextProfile'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'

const bodySchema = contextProfileFieldsSchema.extend({
	/** Admins: publish it as an instance profile, which every member can use. */
	instance: z.boolean().optional(),
}).strict()

/** Creates a context profile, the member's own or (admins) an instance one. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	await authorize(event, profileAbilities().useProfiles)
	const { instance, ...fields } = await readValidatedBody(event, bodySchema)
	if (instance) await authorize(event, profileAbilities().publishProfiles)
	const [profile] = await db.insert(schema.contextProfile).values({ ...fields, ownerId: instance ? null : user.id }).returning()
	return profile!
})
