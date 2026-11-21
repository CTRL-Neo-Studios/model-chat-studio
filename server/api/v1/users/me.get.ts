import { defineEventHandler } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import {useServerAuth} from "#server/utils/core/useServerAuth";
import { userPreferencesSchema } from '#shared/utils/preferences'

export default defineEventHandler(async (event) => {
	const $auth = useServerAuth()
	const user = await $auth.requireUser(event)

	// Which personal keys are set; the keys themselves never leave the server.
	const keys = await db.select({ platform: schema.userApiKey.platform }).from(schema.userApiKey)
		.where(eq(schema.userApiKey.userId, user.id))
	return { ...user, preferences: userPreferencesSchema.parse(user.preferences), apiKeys: keys.map(key => key.platform) }
})
