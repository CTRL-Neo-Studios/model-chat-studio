import { createError, defineEventHandler, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { z } from 'zod'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { sealSecret } from '#server/utils/core/secrets'
import { platformAdapters } from '#server/utils/inference'

const bodySchema = z.object({
	platform: z.enum(['openrouter', 'deepseek']),
	apiKey: z.string().trim().min(1),
})

/** Stores the user's own key for a platform. Turns on it do not count against their budget. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const { platform, apiKey } = await readValidatedBody(event, bodySchema)

	const accepted = await platformAdapters[platform].checkKey(apiKey).catch(() => {
		throw createError({ status: 502, statusText: `Could not reach ${platform} to check the key` })
	})
	if (!accepted) throw createError({ status: 400, statusText: `${platform} rejected this API key` })

	const ciphertext = await sealSecret(apiKey)
	await db.insert(schema.userApiKey).values({ userId: user.id, platform, ciphertext })
		.onConflictDoUpdate({ target: [schema.userApiKey.userId, schema.userApiKey.platform], set: { ciphertext } })
	return { platform, hasKey: true }
})
