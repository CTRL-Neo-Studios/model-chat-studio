import { and, eq } from 'drizzle-orm'
// Relative, not `hub:db`, so this module also loads in `bun test`.
import * as tables from '../../db/schema'
import { openSecret } from '../core/secrets'
import { type Db, getInstanceSettings, getSetting, type InferencePlatformId, type PlatformConfig } from '../core/settings'
import { deepseekPlatform } from './deepseek'
import { openrouterPlatform } from './openrouter'
import type { CatalogEndpoint, CatalogModel, InferencePlatform, Pricing } from './types'

export const platformAdapters: Record<InferencePlatformId, InferencePlatform> = {
	openrouter: openrouterPlatform,
	deepseek: deepseekPlatform,
}

/** What each platform supports, for the admin settings page. */
export const platformCapabilities = Object.fromEntries(
	Object.entries(platformAdapters).map(([id, adapter]) => [id, adapter.capabilities]),
) as Record<InferencePlatformId, InferencePlatform['capabilities']>

export interface ActiveInference {
	platform: InferencePlatform
	apiKey: string
	/** The user's own key is in use: the turn does not count against their budget. */
	byok: boolean
	config: PlatformConfig
}

/**
 * A platform, active or not, and the key to use for this user: their own key for it, else the instance key. `null`
 * without either. The decision model uses OpenRouter this way whichever platform answers.
 */
export async function platformInference(db: Db, userId: string, id: InferencePlatformId): Promise<ActiveInference | null> {
	const config = await getSetting(db, `inference.${id}`)
	const [own] = await db.select({ ciphertext: tables.userApiKey.ciphertext }).from(tables.userApiKey)
		.where(and(eq(tables.userApiKey.userId, userId), eq(tables.userApiKey.platform, id)))
	const sealed = own?.ciphertext ?? config.apiKey
	if (!sealed) return null
	return { platform: platformAdapters[id], apiKey: await openSecret(sealed), byok: !!own, config }
}

/**
 * The active platform and the key to use for this user: their own key for that platform, else the instance key.
 * `null` until an admin has chosen a platform and either key exists.
 */
export async function useInference(db: Db, userId: string): Promise<ActiveInference | null> {
	const id = await getSetting(db, 'inferencePlatform')
	return id ? await platformInference(db, userId, id) : null
}

/** A platform with its instance key, active or not; `null` without a key. For the admin pages. */
export async function instanceInference(db: Db, id: InferencePlatformId): Promise<ActiveInference | null> {
	const config = await getSetting(db, `inference.${id}`)
	if (!config.apiKey) return null
	return { platform: platformAdapters[id], apiKey: await openSecret(config.apiKey), byok: false, config }
}

interface CacheEntry<T> { expires: number, value: Promise<T> }

// ponytail: per-process memory cache; move to a shared store if the app ever runs on several instances.
const catalogCache = new Map<string, CacheEntry<CatalogModel[]>>()
const endpointCache = new Map<string, CacheEntry<CatalogEndpoint[]>>()

/** Shares one in-flight request per key; failures are not cached. */
function cached<T>(cache: Map<string, CacheEntry<T>>, key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
	const hit = cache.get(key)
	if (hit && hit.expires > Date.now()) return hit.value
	const value = load()
	cache.set(key, { expires: Date.now() + ttlMs, value })
	value.catch(() => cache.delete(key))
	return value
}

/** Every model the platform offers, cached for an hour; the admin allowlist is not applied. */
export async function getFullCatalog(inference: ActiveInference): Promise<CatalogModel[]> {
	const { platform, apiKey } = inference
	return await cached(catalogCache, platform.id, 60 * 60_000, () => platform.listModels(apiKey))
}

/** A platform's speech-to-text or Decisions models, cached for an hour; empty where it has none. */
export async function getKindCatalog(inference: ActiveInference, kind: 'stt' | 'decisions'): Promise<CatalogModel[]> {
	const { platform, apiKey } = inference
	const list = kind === 'stt' ? platform.listSttModels : platform.listDecisionModels
	if (!list) return []
	return await cached(catalogCache, `${platform.id}:${kind}`, 60 * 60_000, () => list(apiKey))
}

/** The platform's models, narrowed to the admin allowlist when it has entries. */
export async function getCatalog(db: Db, inference: ActiveInference): Promise<CatalogModel[]> {
	const [models, { models: settings }] = await Promise.all([getFullCatalog(inference), getInstanceSettings(db)])
	const allowed = settings.filter(row => row.platform === inference.platform.id && row.enabled)
	if (!allowed.length) return models
	const ids = new Set(allowed.map(row => row.modelId))
	return models.filter(model => ids.has(model.id))
}

/** The admin's price for a model, when input and output prices are both set. */
export async function getPriceOverride(db: Db, platformId: InferencePlatformId, modelId: string): Promise<Pricing | null> {
	const row = (await getInstanceSettings(db)).models.find(row => row.platform === platformId && row.modelId === modelId)
	if (row?.priceInput == null || row.priceOutput == null) return null
	return { input: row.priceInput, cacheRead: row.priceCachedInput ?? undefined, output: row.priceOutput }
}

/** Upstream providers for one model, cached for ten minutes. Empty on platforms without routing. */
export async function getEndpoints(inference: ActiveInference, modelId: string): Promise<CatalogEndpoint[]> {
	const { platform, apiKey } = inference
	if (!platform.listEndpoints) return []
	return await cached(endpointCache, `${platform.id}:${modelId}`, 10 * 60_000, () => platform.listEndpoints!(apiKey, modelId))
}
