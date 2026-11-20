import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { useServerAuth } from '#server/utils/core/useServerAuth'

export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const { platform } = await getValidatedQuery(event, z.object({ platform: z.enum(['openrouter', 'deepseek']) }))

	await db.delete(schema.userApiKey)
		.where(and(eq(schema.userApiKey.userId, user.id), eq(schema.userApiKey.platform, platform)))
	return { platform, hasKey: false }
})
