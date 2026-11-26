import { defineEventHandler } from 'nuxt/server'
import { db } from 'hub:db'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { getInstanceSettings } from '#server/utils/core/settings'
import { getCatalog, useInference } from '#server/utils/inference'
import { imageSetup } from '#server/utils/chat/images'

/**
 * The active platform's models this user may pick. `platform` is `null` until an admin configures one. `images`
 * says whether a chat's "Images" switch can draw, and if not, why.
 */
export default defineEventHandler(async (event) => {
	const [user, { values: settings }] = await Promise.all([useServerAuth().requireUser(event), getInstanceSettings(db)])
	const inference = await useInference(db, user.id)
	// How many models can answer in one chat; the models menu stops offering more.
	const { maxChatModels } = settings
	if (!inference) return { platform: null, defaultModel: null, maxChatModels, models: [], images: { available: false, reason: 'No model platform is set up yet.' } }

	const { id, capabilities } = inference.platform
	const drawing = await imageSetup(db, user.id)
	return {
		// `safetyCheck`: DeepSeek ignores temperature and top-p while it is on; the settings panel says so.
		platform: { id, capabilities, safetyCheck: capabilities.safetyCheck && settings.safetyCheck },
		defaultModel: inference.config.defaultModel ?? null,
		maxChatModels,
		models: await getCatalog(db, inference),
		images: drawing
			? { available: true, reason: null }
			: { available: false, reason: settings['inference.openrouter'].imageModel ? 'Images are drawn on OpenRouter: an OpenRouter key is needed.' : 'An admin has not chosen an image model yet.' },
	}
})
