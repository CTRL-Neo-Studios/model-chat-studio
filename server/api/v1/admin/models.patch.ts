import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { z } from 'zod'
import { adminAbilities } from '#shared/abilities/adminAbilities'
import { authorize } from '#server/utils/core/authorize'

const price = z.number().nonnegative().nullable()

// Absent fields are left alone; `null` clears a price override.
const bodySchema = z.object({
	platform: z.enum(schema.inferencePlatforms),
	modelId: z.string().min(1),
	enabled: z.boolean().optional(),
	priceInput: price.optional(),
	priceCachedInput: price.optional(),
	priceOutput: price.optional(),
}).strict().refine(body => Object.keys(body).length > 2, 'Nothing to change')

/** Allowlist membership and price override (USD per 1M tokens) for one model. */
export default defineEventHandler(async (event) => {
	await authorize(event, adminAbilities().manageSettings)
	const { platform, modelId, ...fields } = await readValidatedBody(event, bodySchema)
	const [row] = await db.insert(schema.modelSetting).values({ platform, modelId, ...fields })
		.onConflictDoUpdate({ target: [schema.modelSetting.platform, schema.modelSetting.modelId], set: fields })
		.returning()
	return row
})
