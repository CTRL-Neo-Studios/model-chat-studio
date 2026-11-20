import { and, eq } from 'drizzle-orm'
// Relative, not `hub:db`, so this module also loads in `bun test`.
import * as tables from '../../db/schema'
import { openSecret } from '../core/secrets'
import { type Db, getSetting, type InferencePlatformId, type PlatformConfig } from '../core/settings'
import { deepseekPlatform } from './deepseek'
import { openrouterPlatform } from './openrouter'
import type { CatalogEndpoint, CatalogModel, InferencePlatform } from './types'

export const platformAdapters: Record<InferencePlatformId, InferencePlatform> = {
	openrouter: openrouterPlatform,
	deepseek: deepseekPlatform,
}

export interface ActiveInference {
	platform: InferencePlatform
	apiKey: string
	/** The user's own key is in use: the turn does not count against their budget. */
	byok: boolean
	config: PlatformConfig
}

/**
 * The active platform and the key to use for this user: their own key for that platform, else the instance key.
 * `null` until an admin has chosen a platform and either key exists.
 */
export async function useInference(db: Db, userId?: string): Promise<ActiveInference | null> {
	const id = await getSetting(db, 'inferencePlatform')
	if (!id) return null
	const config = await getSetting(db, `inference.${id}`)

	const [own] = userId
		? await db.select({ ciphertext: tables.userApiKey.ciphertext }).from(tables.userApiKey)
				.where(and(eq(tables.userApiKey.userId, userId), eq(tables.userApiKey.platform, id)))
		: []
	const sealed = own?.ciphertext ?? config.apiKey
	if (!sealed) return null

	return { platform: platformAdapters[id], apiKey: await openSecret(sealed), byok: !!own, config }
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

/** The platform's models, cached for an hour, narrowed to the admin allowlist when it has entries. */
export async function getCatalog(db: Db, inference: ActiveInference): Promise<CatalogModel[]> {
	const { platform, apiKey } = inference
	const models = await cached(catalogCache, platform.id, 60 * 60_000, () => platform.listModels(apiKey))

	const allowed = await db.select({ modelId: tables.modelSetting.modelId }).from(tables.modelSetting)
		.where(and(eq(tables.modelSetting.platform, platform.id), eq(tables.modelSetting.enabled, true)))
	if (!allowed.length) return models
	const ids = new Set(allowed.map(row => row.modelId))
	return models.filter(model => ids.has(model.id))
}

/** Upstream providers for one model, cached for ten minutes. Empty on platforms without routing. */
export async function getEndpoints(inference: ActiveInference, modelId: string): Promise<CatalogEndpoint[]> {
	const { platform, apiKey } = inference
	if (!platform.listEndpoints) return []
	return await cached(endpointCache, `${platform.id}:${modelId}`, 10 * 60_000, () => platform.listEndpoints!(apiKey, modelId))
}
