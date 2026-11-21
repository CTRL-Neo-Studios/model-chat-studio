import { createError, defineEventHandler } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { assertRateLimit } from '#server/utils/core/rateLimit'
import { assertWithinBudget, monthlyBudgetStatus } from '#server/utils/chat/turns'
import { useInference } from '#server/utils/inference'
import { wavDurationSeconds } from '#server/utils/inference/wav'

// DeepSeek's limits; the app records 16 kHz mono, so 120 s is 3.84 MB.
const MAX_BYTES = 8 * 1024 * 1024
const MAX_SECONDS = 120

/** Dictation: a 16-bit PCM WAV clip (form field `file`) in, `{ text }` out, on the active platform. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	assertRateLimit(`stt:${user.id}`, 20, 60_000, 'recordings')
	const audio = (await event.req.formData()).get('file')
	if (!(audio instanceof File)) throw createError({ status: 400, statusText: 'Send the recording in the `file` field' })
	if (audio.size > MAX_BYTES) throw createError({ status: 413, statusText: 'Recordings can be at most 8 MB' })
	const wav = new Uint8Array(await audio.arrayBuffer())
	const seconds = wavDurationSeconds(wav)
	// Checked before the call, so an over-long clip is not billed.
	if (seconds === null) throw createError({ status: 400, statusText: 'Send a 16-bit PCM WAV recording' })
	if (seconds > MAX_SECONDS) throw createError({ status: 400, statusText: 'Recordings can be at most 2 minutes' })

	const [inference, budget] = await Promise.all([useInference(db, user.id), monthlyBudgetStatus(db, user)])
	if (!inference) throw createError({ status: 503, statusText: 'No model platform is configured yet. An admin can set one up in the settings.' })
	const { platform, apiKey, byok, config } = inference
	if (platform.capabilities.sttModel && !config.sttModel) {
		throw createError({ status: 503, statusText: 'Dictation is not set up yet. An admin can choose a speech-to-text model in the settings.' })
	}
	assertWithinBudget(budget, byok)

	const { text, costUsd } = await platform.transcribe({ apiKey, wav, model: config.sttModel }).catch((error) => {
		console.error('[transcriptions] failed', error)
		throw createError({ status: 502, statusText: 'Transcription failed. Try again.' })
	})
	await db.insert(schema.usageEvent).values({
		userId: user.id, kind: 'stt', platform: platform.id, model: config.sttModel ?? null, byok, costUsd,
	})
	return { text: text.trim() }
})
