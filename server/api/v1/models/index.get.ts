import { defineEventHandler } from 'nuxt/server'
import { db } from 'hub:db'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { getCatalog, useInference } from '#server/utils/inference'

/** The active platform's models this user may pick. `platform` is `null` until an admin configures one. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const inference = await useInference(db, user.id)
	if (!inference) return { platform: null, defaultModel: null, models: [] }

	const { id, capabilities } = inference.platform
	return {
		platform: { id, capabilities },
		defaultModel: inference.config.defaultModel ?? null,
		models: await getCatalog(db, inference),
	}
})
