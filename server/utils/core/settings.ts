import { eq } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { z } from 'zod'
// Relative, not `hub:db`, so this module also loads in `bun test`.
import * as tables from '../../db/schema'

/** Any Drizzle Postgres database or transaction over this schema: `hub:db` in the app, PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT, typeof tables>
export type InferencePlatformId = typeof tables.inferencePlatforms[number]

const platformConfigSchema = z.object({
	/** Sealed with `sealSecret`; never sent to the browser. */
	apiKey: z.string().optional(),
	defaultModel: z.string().optional(),
	titleModel: z.string().optional(),
	sttModel: z.string().optional(),
})

export type PlatformConfig = z.infer<typeof platformConfigSchema>

// Unset or invalid stored values fall back to the default after `.catch`.
const settingSchemas = {
	signupMode: z.enum(['invite', 'open', 'closed']).catch('invite'),
	safetyCheck: z.boolean().catch(false),
	/** USD per member per month on the instance key; `null` is unlimited. A member's own budget wins. */
	defaultMonthlyBudgetUsd: z.number().nonnegative().nullable().catch(null),
	inferencePlatform: z.enum(tables.inferencePlatforms).nullable().catch(null),
	/** Models that answer each message in one chat. */
	maxChatModels: z.number().int().min(1).max(12).catch(4),
	/** Times one answer can be regenerated. */
	maxRegenerations: z.number().int().min(1).max(1000).catch(50),
	/** Retries of a platform call that failed before any text arrived (rate limits, server errors). */
	maxRetries: z.number().int().min(0).max(10).catch(5),
	'inference.openrouter': platformConfigSchema.catch({}),
	'inference.deepseek': platformConfigSchema.catch({}),
}

export type SettingKey = keyof typeof settingSchemas
export type SettingValue<K extends SettingKey> = z.output<(typeof settingSchemas)[K]>

export async function getSetting<K extends SettingKey>(db: Db, key: K): Promise<SettingValue<K>> {
	const [row] = await db.select({ value: tables.setting.value }).from(tables.setting).where(eq(tables.setting.key, key)).limit(1)
	return settingSchemas[key].parse(row?.value) as SettingValue<K>
}

/** `null` removes the setting, which restores its default. */
export async function setSetting<K extends SettingKey>(db: Db, key: K, value: SettingValue<K> | null): Promise<void> {
	if (value === null) {
		await db.delete(tables.setting).where(eq(tables.setting.key, key))
		return
	}
	await db.insert(tables.setting).values({ key, value })
		.onConflictDoUpdate({ target: tables.setting.key, set: { value } })
}

/** Instance settings as admins see them: API keys are reported as set or not, never returned. */
export async function adminSettingsView(db: Db) {
	const platforms = {} as Record<InferencePlatformId, Omit<PlatformConfig, 'apiKey'> & { hasKey: boolean }>
	for (const id of tables.inferencePlatforms) {
		const { apiKey, ...config } = await getSetting(db, `inference.${id}`)
		platforms[id] = { ...config, hasKey: !!apiKey }
	}
	return {
		signupMode: await getSetting(db, 'signupMode'),
		safetyCheck: await getSetting(db, 'safetyCheck'),
		defaultMonthlyBudgetUsd: await getSetting(db, 'defaultMonthlyBudgetUsd'),
		inferencePlatform: await getSetting(db, 'inferencePlatform'),
		maxChatModels: await getSetting(db, 'maxChatModels'),
		maxRegenerations: await getSetting(db, 'maxRegenerations'),
		maxRetries: await getSetting(db, 'maxRetries'),
		platforms,
	}
}
