import { createError, defineEventHandler, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { z } from 'zod'
import { userPreferencesSchema } from '#shared/utils/preferences'
import { SPEECH_PIECE_MAX } from '#shared/utils/speech'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { assertRateLimit } from '#server/utils/core/rateLimit'
import { assertWithinBudget, monthlyBudgetStatus } from '#server/utils/chat/turns'
import { speechSetup, useInference } from '#server/utils/inference'

const bodySchema = z.object({
	/** One piece of an answer, already plain (`speechPieces`). */
	text: z.string().trim().min(1).max(SPEECH_PIECE_MAX),
	/** A voice the platform offers; otherwise the member's, else the platform's default. */
	voice: z.string().min(1).max(100).optional(),
}).strict()

/**
 * Read-aloud: one piece of text in, its audio out, on the active platform (milestone 10 plan, section 3). Whoever
 * listens pays: budget-checked before, recorded as usage of kind `tts`. Nothing is stored.
 */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	assertRateLimit(`tts:${user.id}`, 60, 60_000, 'pieces of speech')
	const { text, voice } = await readValidatedBody(event, bodySchema)

	const [inference, budget] = await Promise.all([useInference(db, user.id), monthlyBudgetStatus(db, user)])
	if (!inference) throw createError({ status: 503, statusText: 'No model platform is configured yet. An admin can set one up in the settings.' })
	const { platform, apiKey, byok } = inference
	const setup = await speechSetup(inference).catch(() => {
		throw createError({ status: 502, statusText: 'The platform did not return its voices. Try again.' })
	})
	if (!setup) throw createError({ status: 503, statusText: 'Read-aloud is not set up yet. An admin can choose a speech model in the settings.' })
	assertWithinBudget(budget, byok)

	const offered = (id: string | undefined) => id && setup.voices.some(entry => entry.id === id) ? id : undefined
	const chosen = offered(voice) ?? offered(userPreferencesSchema.parse(user.preferences ?? {}).voices[platform.id]) ?? setup.defaultVoice
	const { audio, mediaType, costUsd } = await platform.speak({ apiKey, text, voice: chosen, model: setup.model, pricePerMillionChars: setup.pricePerMillionChars }).catch((error) => {
		console.error('[speech] failed', error)
		throw createError({ status: 502, statusText: 'The text could not be read aloud. Try again.' })
	})
	await db.insert(schema.usageEvent).values({ userId: user.id, kind: 'tts', platform: platform.id, model: setup.model ?? null, byok, costUsd })
	return new Response(audio as Uint8Array<ArrayBuffer>, {
		headers: { 'Content-Type': mediaType, 'Content-Length': String(audio.length), 'Cache-Control': 'no-store', 'X-Voice': chosen },
	})
})
