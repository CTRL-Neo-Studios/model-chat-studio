import { defineEventHandler } from 'nuxt/server'
import { db } from 'hub:db'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { getSetting } from '#server/utils/core/settings'
import { getCatalog, useInference } from '#server/utils/inference'

/** The active platform's models this user may pick. `platform` is `null` until an admin configures one. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const inference = await useInference(db, user.id)
	// How many models can answer in one chat; the models menu stops offering more.
	const maxChatModels = await getSetting(db, 'maxChatModels')
	if (!inference) return { platform: null, defaultModel: null, maxChatModels, models: [] }

	const { id, capabilities } = inference.platform
	return {
		// `safetyCheck`: DeepSeek ignores temperature and top-p while it is on; the settings panel says so.
		platform: { id, capabilities, safetyCheck: capabilities.safetyCheck && await getSetting(db, 'safetyCheck') },
		defaultModel: inference.config.defaultModel ?? null,
		maxChatModels,
		models: await getCatalog(db, inference),
	}
})
