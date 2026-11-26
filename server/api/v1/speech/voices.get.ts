import { createError, defineEventHandler } from 'nuxt/server'
import { db } from 'hub:db'
import { userPreferencesSchema } from '#shared/utils/preferences'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { speechSetup, useInference } from '#server/utils/inference'

/**
 * Read-aloud on the active platform: its voices, its default, and the member's choice (`null`: the default).
 * `available` is false until it is set up (on OpenRouter, an admin chooses a speech model).
 */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const inference = await useInference(db, user.id)
	if (!inference) return { available: false as const, platform: null, voices: [], defaultVoice: null, voice: null }
	const setup = await speechSetup(inference).catch(() => {
		throw createError({ status: 502, statusText: 'The platform did not return its voices. Try again.' })
	})
	const platform = inference.platform.id
	if (!setup) return { available: false as const, platform, voices: [], defaultVoice: null, voice: null }
	const chosen = userPreferencesSchema.parse(user.preferences ?? {}).voices[platform]
	return {
		available: true as const,
		platform,
		voices: setup.voices,
		defaultVoice: setup.defaultVoice,
		voice: chosen && setup.voices.some(entry => entry.id === chosen) ? chosen : null,
	}
})
