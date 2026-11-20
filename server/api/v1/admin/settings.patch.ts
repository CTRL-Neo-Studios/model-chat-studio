import { createError, defineEventHandler, readValidatedBody } from 'nuxt/server'
import { db } from 'hub:db'
import { z } from 'zod'
import { adminAbilities } from '#shared/abilities/adminAbilities'
import { authorize } from '#server/utils/core/authorize'
import { sealSecret } from '#server/utils/core/secrets'
import { adminSettingsView, getSetting, setSetting, type InferencePlatformId, type PlatformConfig } from '#server/utils/core/settings'
import { platformAdapters } from '#server/utils/inference'

// For each field: absent leaves it alone, `null` clears it.
const platformPatch = z.object({
	apiKey: z.string().trim().min(1).nullable(),
	defaultModel: z.string().min(1).nullable(),
	titleModel: z.string().min(1).nullable(),
	sttModel: z.string().min(1).nullable(),
}).partial().strict()

const bodySchema = z.object({
	signupMode: z.enum(['invite', 'open', 'closed']),
	safetyCheck: z.boolean(),
	defaultMonthlyBudgetUsd: z.number().nonnegative().nullable(),
	inferencePlatform: z.enum(['openrouter', 'deepseek']).nullable(),
	platforms: z.object({ openrouter: platformPatch, deepseek: platformPatch }).partial().strict(),
}).partial().strict()

export default defineEventHandler(async (event) => {
	await authorize(event, adminAbilities().manageSettings)
	const body = await readValidatedBody(event, bodySchema)

	// Check every new key before writing anything, so a rejected key changes nothing.
	const configs: Partial<Record<InferencePlatformId, PlatformConfig>> = {}
	for (const [id, patch] of Object.entries(body.platforms ?? {}) as [InferencePlatformId, z.infer<typeof platformPatch>][]) {
		const { apiKey, ...fields } = patch
		const current = await getSetting(db, `inference.${id}`)
		let sealedKey = current.apiKey
		if (apiKey) {
			const accepted = await platformAdapters[id].checkKey(apiKey).catch(() => {
				throw createError({ status: 502, statusText: `Could not reach ${id} to check the key` })
			})
			if (!accepted) throw createError({ status: 400, statusText: `${id} rejected this API key` })
			sealedKey = await sealSecret(apiKey)
		}
		else if (apiKey === null) {
			sealedKey = undefined
		}
		// `undefined` fields are left out when the value is stored as JSON.
		const cleared = Object.fromEntries(Object.entries(fields).map(([field, value]) => [field, value ?? undefined]))
		const config: PlatformConfig = { ...current, ...cleared, apiKey: sealedKey }
		configs[id] = config
	}

	await db.transaction(async (tx) => {
		if (body.signupMode !== undefined) await setSetting(tx, 'signupMode', body.signupMode)
		if (body.safetyCheck !== undefined) await setSetting(tx, 'safetyCheck', body.safetyCheck)
		if (body.defaultMonthlyBudgetUsd !== undefined) await setSetting(tx, 'defaultMonthlyBudgetUsd', body.defaultMonthlyBudgetUsd)
		if (body.inferencePlatform !== undefined) await setSetting(tx, 'inferencePlatform', body.inferencePlatform)
		for (const [id, config] of Object.entries(configs) as [InferencePlatformId, PlatformConfig][]) {
			await setSetting(tx, `inference.${id}`, config)
		}
	})

	return await adminSettingsView(db)
})
