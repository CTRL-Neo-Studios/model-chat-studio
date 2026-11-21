import { afterEach, beforeEach, expect, test } from 'bun:test'
import * as schema from '../server/db/schema'
import { decryptSecret, encryptSecret, sealSecret } from '../server/utils/core/secrets'
import { getSetting, setModelSetting, setSetting, setSettings } from '../server/utils/core/settings'
import { getCatalog, getPriceOverride, useInference } from '../server/utils/inference'
import { createTestDb, type TestDb } from './db'

let db: TestDb
let userId: string

beforeEach(async () => {
	db = await createTestDb()
	const [user] = await db.insert(schema.user).values({ githubId: 1, username: 'u1' }).returning()
	userId = user!.id
})

const realFetch = globalThis.fetch
afterEach(() => {
	globalThis.fetch = realFetch
})

/** Answers the two catalog endpoints with distinct models, keyed by the key that was sent. */
function fakeCatalogs() {
	const seenKeys: string[] = []
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		seenKeys.push(String(new Headers(init?.headers).get('authorization')))
		if (url.startsWith('https://openrouter.ai/')) {
			const model = (id: string) => ({ id, name: id, context_length: 1, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' }, top_provider: { max_completion_tokens: 1 }, supported_parameters: [] })
			return Response.json({ data: [model('openai/a'), model('openai/b')] })
		}
		return Response.json({ data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }] })
	}) as typeof fetch
	return seenKeys
}

test('a sealed key opens again, under its own key only, with a fresh IV each time', async () => {
	const key = 'a'.repeat(64)
	const sealed = await encryptSecret('sk-or-v1-secret', key)
	expect(await decryptSecret(sealed, key)).toBe('sk-or-v1-secret')
	expect(await encryptSecret('sk-or-v1-secret', key)).not.toBe(sealed)
	expect(decryptSecret(sealed, 'b'.repeat(64))).rejects.toThrow()
	expect(Buffer.from(sealed, 'base64')[0]).toBe(1)
	expect(sealed).not.toContain('secret')
})

test('nothing is active until an admin picks a platform with a key', async () => {
	expect(await useInference(db, userId)).toBeNull()
	await setSetting(db, 'inferencePlatform', 'openrouter')
	expect(await useInference(db, userId)).toBeNull()
})

test("a member's own key wins over the instance key, and is flagged as theirs", async () => {
	await setSetting(db, 'inferencePlatform', 'openrouter')
	await setSetting(db, 'inference.openrouter', { apiKey: await sealSecret('instance-key'), defaultModel: 'openai/a' })

	const shared = await useInference(db, userId)
	expect(shared).toMatchObject({ apiKey: 'instance-key', byok: false, config: { defaultModel: 'openai/a' } })

	await db.insert(schema.userApiKey).values({ userId, platform: 'openrouter', ciphertext: await sealSecret('own-key') })
	expect(await useInference(db, userId)).toMatchObject({ apiKey: 'own-key', byok: true })
	// A key for another platform does not count.
	await db.insert(schema.userApiKey).values({ userId, platform: 'deepseek', ciphertext: await sealSecret('own-deepseek') })
	await setSetting(db, 'inferencePlatform', 'deepseek')
	await setSetting(db, 'inference.deepseek', { apiKey: await sealSecret('instance-deepseek') })
	expect(await useInference(db, userId)).toMatchObject({ apiKey: 'own-deepseek', byok: true })
})

test('switching platform switches the catalog; each keeps its own settings', async () => {
	const seenKeys = fakeCatalogs()
	await setSetting(db, 'inference.openrouter', { apiKey: await sealSecret('or-key'), defaultModel: 'openai/a' })
	await setSetting(db, 'inference.deepseek', { apiKey: await sealSecret('ds-key'), defaultModel: 'deepseek-flash' })

	await setSetting(db, 'inferencePlatform', 'openrouter')
	const openrouter = (await useInference(db, userId))!
	expect((await getCatalog(db, openrouter)).map(m => m.id)).toEqual(['openai/a', 'openai/b'])

	await setSetting(db, 'inferencePlatform', 'deepseek')
	const deepseek = (await useInference(db, userId))!
	expect(deepseek.platform.id).toBe('deepseek')
	expect(deepseek.config.defaultModel).toBe('deepseek-flash')
	expect((await getCatalog(db, deepseek)).map(m => m.id)).toEqual(['deepseek-flash', 'deepseek-v4-pro'])

	expect(seenKeys).toEqual(['Bearer or-key', 'Bearer ds-key'])
	expect((await getSetting(db, 'inference.openrouter')).defaultModel).toBe('openai/a')
})

test('the allowlist narrows the catalog only through enabled rows', async () => {
	fakeCatalogs()
	await setSetting(db, 'inferencePlatform', 'deepseek')
	await setSetting(db, 'inference.deepseek', { apiKey: await sealSecret('ds-key') })
	const inference = (await useInference(db, userId))!

	// A price override alone allowlists nothing.
	await setModelSetting(db, { platform: 'deepseek', modelId: 'deepseek-flash', priceInput: 1, priceOutput: 2 })
	expect(await getCatalog(db, inference)).toHaveLength(2)
	expect(await getPriceOverride(db, 'deepseek', 'deepseek-flash')).toEqual({ input: 1, cacheRead: undefined, output: 2 })

	await setModelSetting(db, { platform: 'deepseek', modelId: 'deepseek-v4-pro', enabled: true })
	expect((await getCatalog(db, inference)).map(m => m.id)).toEqual(['deepseek-v4-pro'])

	// Another platform's allowlist does not apply.
	await setModelSetting(db, { platform: 'openrouter', modelId: 'openai/a', enabled: true })
	expect((await getCatalog(db, inference)).map(m => m.id)).toEqual(['deepseek-v4-pro'])
})

test('a write is read back at once, and null restores the default', async () => {
	await setSettings(db, { maxChatModels: 6, safetyCheck: true })
	expect(await getSetting(db, 'maxChatModels')).toBe(6)
	await setSettings(db, { maxChatModels: 3, safetyCheck: null })
	expect(await getSetting(db, 'maxChatModels')).toBe(3)
	expect(await getSetting(db, 'safetyCheck')).toBe(false)
})
