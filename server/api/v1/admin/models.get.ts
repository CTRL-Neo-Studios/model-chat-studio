import { createError, defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { db } from 'hub:db'
import { z } from 'zod'
import { adminAbilities } from '#shared/abilities/adminAbilities'
import { authorize } from '#server/utils/core/authorize'
import { getInstanceSettings } from '#server/utils/core/settings'
import { getFullCatalog, getKindCatalog, instanceInference } from '#server/utils/inference'

const querySchema = z.object({
	/** Defaults to the active platform. */
	platform: z.enum(['openrouter', 'deepseek']).optional(),
	/** `stt`: speech-to-text models, for the `sttModel` setting; `decisions`: for `decisionModel`. */
	kind: z.enum(['chat', 'stt', 'decisions']).default('chat'),
})

/**
 * Every model on a platform (instance key) with its allowlist state and price override.
 * With no enabled row, every model is allowed.
 */
export default defineEventHandler(async (event) => {
	await authorize(event, adminAbilities().manageSettings)
	const query = await getValidatedQuery(event, querySchema)
	const id = query.platform ?? (await getInstanceSettings(db)).values.inferencePlatform
	if (!id) return { platform: null, hasKey: false, models: [] }
	const inference = await instanceInference(db, id)
	if (!inference) return { platform: id, hasKey: false, models: [] }

	const catalog = await (query.kind === 'chat' ? getFullCatalog(inference) : getKindCatalog(inference, query.kind)).catch(() => {
		throw createError({ status: 502, statusText: 'The platform did not return its models. Check the key, or try again.' })
	})
	const byModel = Object.fromEntries((await getInstanceSettings(db)).models.filter(row => row.platform === id).map(row => [row.modelId, row]))
	const models = catalog.map((model) => {
		const row = byModel[model.id]
		return {
			...model,
			enabled: row?.enabled ?? false,
			priceOverride: { input: row?.priceInput ?? null, cacheRead: row?.priceCachedInput ?? null, output: row?.priceOutput ?? null },
		}
	})
	return { platform: id, hasKey: true, models }
})
