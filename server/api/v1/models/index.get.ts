import { defineEventHandler } from 'nuxt/server'
import { db } from 'hub:db'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { getInstanceSettings } from '#server/utils/core/settings'
import { getCatalog, useInference } from '#server/utils/inference'

/** The active platform's models this user may pick. `platform` is `null` until an admin configures one. */
export default defineEventHandler(async (event) => {
	const [user, { values: settings }] = await Promise.all([useServerAuth().requireUser(event), getInstanceSettings(db)])
	const inference = await useInference(db, user.id)
	// How many models can answer in one chat; the models menu stops offering more.
	const { maxChatModels } = settings
	if (!inference) return { platform: null, defaultModel: null, maxChatModels, models: [] }

	const { id, capabilities } = inference.platform
	return {
		// `safetyCheck`: DeepSeek ignores temperature and top-p while it is on; the settings panel says so.
		platform: { id, capabilities, safetyCheck: capabilities.safetyCheck && settings.safetyCheck },
		defaultModel: inference.config.defaultModel ?? null,
		maxChatModels,
		models: await getCatalog(db, inference),
	}
})
