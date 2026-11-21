import { createError, defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { adminAbilities } from '#shared/abilities/adminAbilities'
import { authorize } from '#server/utils/core/authorize'
import { getSetting } from '#server/utils/core/settings'
import { getFullCatalog, getSttCatalog, instanceInference } from '#server/utils/inference'

const querySchema = z.object({
	/** Defaults to the active platform. */
	platform: z.enum(['openrouter', 'deepseek']).optional(),
	/** `stt`: speech-to-text models, for the `sttModel` setting. */
	kind: z.enum(['chat', 'stt']).default('chat'),
})

/**
 * Every model on a platform (instance key) with its allowlist state and price override.
 * With no enabled row, every model is allowed.
 */
export default defineEventHandler(async (event) => {
	await authorize(event, adminAbilities().manageSettings)
	const query = await getValidatedQuery(event, querySchema)
	const id = query.platform ?? await getSetting(db, 'inferencePlatform')
	if (!id) return { platform: null, hasKey: false, models: [] }
	const inference = await instanceInference(db, id)
	if (!inference) return { platform: id, hasKey: false, models: [] }

	const [catalog, settings] = await Promise.all([
		(query.kind === 'stt' ? getSttCatalog(inference) : getFullCatalog(inference)).catch(() => {
			throw createError({ status: 502, statusText: 'The platform did not return its models. Check the key, or try again.' })
		}),
		db.select().from(schema.modelSetting).where(eq(schema.modelSetting.platform, id)),
	])
	const byModel = Object.fromEntries(settings.map(row => [row.modelId, row]))
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
