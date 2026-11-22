import { inArray, sql } from 'drizzle-orm'
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
	/** OpenRouter only: the Decisions model that picks a group round's speakers; empty is off. */
	decisionModel: z.string().optional(),
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
type SettingValues = { [K in SettingKey]: SettingValue<K> }
type ModelSetting = typeof tables.modelSetting.$inferSelect

interface InstanceSettings {
	values: SettingValues
	/** Allowlist membership and price overrides, all platforms. */
	models: ModelSetting[]
}

// ponytail: per-process cache; with several server instances, another one sees an admin's change up to 30 s late. A shared store or LISTEN/NOTIFY would fix that.
let settingsCache = new WeakMap<Db, { expires: number, value: Promise<InstanceSettings> }>()

/** Every setting and model setting, read in one round trip and cached for 30 s per database handle. */
export function getInstanceSettings(db: Db): Promise<InstanceSettings> {
	const hit = settingsCache.get(db)
	if (hit && hit.expires > Date.now()) return hit.value
	const value = Promise.all([db.select().from(tables.setting), db.select().from(tables.modelSetting)]).then(([rows, models]) => {
		const stored = Object.fromEntries(rows.map(row => [row.key, row.value]))
		const values = Object.fromEntries(Object.entries(settingSchemas).map(([key, schema]) => [key, schema.parse(stored[key])])) as SettingValues
		return { values, models }
	})
	const entry = { expires: Date.now() + 30_000, value }
	settingsCache.set(db, entry)
	value.catch(() => {
		if (settingsCache.get(db) === entry) settingsCache.delete(db)
	})
	return value
}

/** Drops every cached read, so the next one sees a write. A read already in flight is not cached. */
function forgetSettings() {
	settingsCache = new WeakMap()
}

export async function getSetting<K extends SettingKey>(db: Db, key: K): Promise<SettingValue<K>> {
	return (await getInstanceSettings(db)).values[key]
}

/** Writes several settings at once; `null` removes one, which restores its default. */
export async function setSettings(db: Db, patch: { [K in SettingKey]?: SettingValue<K> | null }): Promise<void> {
	const entries = Object.entries(patch).filter(([, value]) => value !== undefined)
	const removed = entries.filter(([, value]) => value === null).map(([key]) => key)
	const stored = entries.filter(([, value]) => value !== null).map(([key, value]) => ({ key, value }))
	const write = async (tx: Db) => {
		if (removed.length) await tx.delete(tables.setting).where(inArray(tables.setting.key, removed))
		if (stored.length) await tx.insert(tables.setting).values(stored).onConflictDoUpdate({ target: tables.setting.key, set: { value: sql`excluded.value` } })
	}
	await (removed.length && stored.length ? db.transaction(write) : write(db))
	forgetSettings()
}

/** `null` removes the setting, which restores its default. */
export async function setSetting<K extends SettingKey>(db: Db, key: K, value: SettingValue<K> | null): Promise<void> {
	await setSettings(db, { [key]: value })
}

/** Allowlist membership and price override for one model; absent fields are left alone. */
export async function setModelSetting(db: Db, values: Pick<ModelSetting, 'platform' | 'modelId'> & Partial<Omit<ModelSetting, 'platform' | 'modelId'>>) {
	const { platform, modelId, ...fields } = values
	const [row] = await db.insert(tables.modelSetting).values(values)
		.onConflictDoUpdate({ target: [tables.modelSetting.platform, tables.modelSetting.modelId], set: fields })
		.returning()
	forgetSettings()
	return row!
}

/** Instance settings as admins see them: API keys are reported as set or not, never returned. */
export async function adminSettingsView(db: Db) {
	const { values } = await getInstanceSettings(db)
	const platforms = {} as Record<InferencePlatformId, Omit<PlatformConfig, 'apiKey'> & { hasKey: boolean }>
	for (const id of tables.inferencePlatforms) {
		const { apiKey, ...config } = values[`inference.${id}`]
		platforms[id] = { ...config, hasKey: !!apiKey }
	}
	return {
		signupMode: values.signupMode,
		safetyCheck: values.safetyCheck,
		defaultMonthlyBudgetUsd: values.defaultMonthlyBudgetUsd,
		inferencePlatform: values.inferencePlatform,
		maxChatModels: values.maxChatModels,
		maxRegenerations: values.maxRegenerations,
		maxRetries: values.maxRetries,
		platforms,
	}
}
