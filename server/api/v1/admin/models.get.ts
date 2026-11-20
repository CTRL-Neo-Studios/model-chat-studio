import { defineEventHandler } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { adminAbilities } from '#shared/abilities/adminAbilities'
import { authorize } from '#server/utils/core/authorize'
import { getFullCatalog, useInference } from '#server/utils/inference'

/**
 * Every model on the active platform (instance key) with its allowlist state and price override.
 * With no enabled row, every model is allowed.
 */
export default defineEventHandler(async (event) => {
	await authorize(event, adminAbilities().manageSettings)
	const inference = await useInference(db)
	if (!inference) return { platform: null, models: [] }

	const { id } = inference.platform
	const settings = await db.select().from(schema.modelSetting).where(eq(schema.modelSetting.platform, id))
	const byModel = Object.fromEntries(settings.map(row => [row.modelId, row]))
	const models = (await getFullCatalog(inference)).map((model) => {
		const row = byModel[model.id]
		return {
			...model,
			enabled: row?.enabled ?? false,
			priceOverride: { input: row?.priceInput ?? null, cacheRead: row?.priceCachedInput ?? null, output: row?.priceOutput ?? null },
		}
	})
	return { platform: id, models }
})
