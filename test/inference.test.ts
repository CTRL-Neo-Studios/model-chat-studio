import { afterEach, describe, expect, test } from 'bun:test'
import { streamText } from 'ai'
import { deepseekPlatform, deepseekPrice, isPeak } from '../server/utils/inference/deepseek'
import { openrouterPlatform, toOpenRouterModel } from '../server/utils/inference/openrouter'
import type { TurnInput } from '../server/utils/inference/types'
import { deepseekChunks, openrouterChunks, sseResponse } from './fixtures/sse'

const realFetch = globalThis.fetch
afterEach(() => {
	globalThis.fetch = realFetch
})

/** Answers every request with `chunks` and records the JSON bodies sent. */
function captureFetch(chunks: unknown[]) {
	const bodies: Record<string, unknown>[] = []
	globalThis.fetch = (async (_url: string, init?: RequestInit) => {
		bodies.push(JSON.parse(String(init?.body)))
		return sseResponse(chunks)
	}) as typeof fetch
	return bodies
}

const turn = (input: Partial<TurnInput>): TurnInput => ({ apiKey: 'sk-test', model: 'm', userId: 'user-1', firstTurn: false, safetyCheck: false, ...input })

async function run(input: TurnInput, platform = input.model.includes('/') ? openrouterPlatform : deepseekPlatform) {
	const prepared = platform.prepare(input)
	const result = streamText({ ...prepared, prompt: 'hi', maxRetries: 0 })
	const parts: { type: string }[] = []
	for await (const part of result.fullStream) parts.push(part)
	return { parts, steps: await result.steps }
}

describe('OpenRouter', () => {
	test('sends routing by endpoint tag, reasoning effort, web search and the user', async () => {
		const bodies = captureFetch(openrouterChunks())
		await run(turn({ model: 'deepseek/deepseek-chat', providers: ['deepinfra/fp4', 'moonshotai'], allowFallbacks: false, reasoningLevel: 'high', webSearch: true }))
		const [body] = bodies
		expect(body!.model).toBe('deepseek/deepseek-chat')
		expect(body!.provider).toEqual({ only: ['deepinfra/fp4', 'moonshotai'], order: ['deepinfra/fp4', 'moonshotai'], allow_fallbacks: false })
		expect(body!.reasoning).toEqual({ effort: 'high' })
		expect(body!.tools).toEqual([{ type: 'openrouter:web_search' }])
		expect(body!.user).toBe('user-1')
	})

	test('leaves routing and reasoning to OpenRouter unless chosen; `none` turns reasoning off', async () => {
		const bodies = captureFetch(openrouterChunks())
		await run(turn({ model: 'a/b' }))
		await run(turn({ model: 'a/b', reasoningLevel: 'none' }))
		expect(bodies[0]!.provider).toBeUndefined()
		expect(bodies[0]!.reasoning).toBeUndefined()
		expect(bodies[0]!.tools).toBeUndefined()
		expect(bodies[1]!.reasoning).toEqual({ enabled: false })
	})

	test('reads cost, serving provider and tokens; citations become sources', async () => {
		captureFetch(openrouterChunks())
		const { parts, steps } = await run(turn({ model: 'deepseek/deepseek-chat' }))
		expect(parts.some(part => part.type === 'source')).toBe(true)
		expect(openrouterPlatform.usage({ model: 'deepseek/deepseek-chat', steps })).toEqual({
			provider: 'DeepInfra', costUsd: 0.000123, inputTokens: 194, cachedInputTokens: 40, outputTokens: 20, reasoningTokens: 5,
		})
	})

	test('reports an unknown cost as null rather than zero', async () => {
		captureFetch(openrouterChunks(null))
		const { steps } = await run(turn({ model: 'a/b' }))
		expect(openrouterPlatform.usage({ model: 'a/b', steps }).costUsd).toBeNull()
	})

	test('normalizes catalog entries', () => {
		const base = {
			id: 'moonshotai/kimi-k2.6', name: 'Kimi', context_length: 262144,
			architecture: { input_modalities: ['text', 'image', 'audio'], output_modalities: ['text'] },
			pricing: { prompt: '0.00000065', completion: '0.00000341', input_cache_read: '0.00000015' },
			top_provider: { max_completion_tokens: 235929 },
			supported_parameters: ['tools', 'reasoning'],
		}
		const toggleOnly = toOpenRouterModel({ ...base, reasoning: { mandatory: false, default_enabled: true } })
		expect(toggleOnly.pricing!.input).toBeCloseTo(0.65)
		expect(toggleOnly.pricing!.cacheRead).toBeCloseTo(0.15)
		expect(toggleOnly.inputModalities).toEqual(['text', 'image'])
		expect(toggleOnly.webSearch).toBe(true)
		expect(toggleOnly.reasoningLevels).toEqual([])
		expect(toggleOnly.reasoning).toEqual({ mandatory: false, defaultEnabled: true })
		expect(toOpenRouterModel({ ...base, reasoning: { supported_efforts: null } }).reasoningLevels).toContain('high')
		expect(toOpenRouterModel({ ...base, supported_parameters: [] }).webSearch).toBe(false)
	})
})

describe('DeepSeek', () => {
	test('adds web tools, title and safety check to the body only when asked', async () => {
		const bodies = captureFetch(deepseekChunks)
		await run(turn({ model: 'deepseek-flash', webSearch: true, firstTurn: true, safetyCheck: true, reasoningLevel: 'max' }))
		await run(turn({ model: 'deepseek-flash' }))
		await run(turn({ model: 'deepseek-v4-pro', webSearch: true, reasoningLevel: 'none' }))

		const [all, plain, pro] = bodies
		expect(all!.tools).toEqual([{ type: 'deepseek_web_search' }, { type: 'deepseek_read_url' }])
		expect(all!.title).toEqual({ enabled: true })
		expect(all!.safety_check).toEqual({ level: 'high' })
		expect(all!.thinking).toEqual({ type: 'enabled' })
		expect(all!.reasoning_effort).toBe('max')
		expect(all!.user_id).toBe('user-1')

		expect(plain!.tools).toBeUndefined()
		expect(plain!.title).toBeUndefined()
		expect(plain!.safety_check).toBeUndefined()

		// Web search is documented for deepseek-flash only.
		expect(pro!.tools).toBeUndefined()
		expect(pro!.thinking).toEqual({ type: 'disabled' })
		expect(pro!.reasoning_effort).toBeUndefined()
	})

	test('turns the last chunk into sources and a title, and maps cache hits', async () => {
		captureFetch(deepseekChunks)
		const { parts, steps } = await run(turn({ model: 'deepseek-flash' }))
		expect(parts.filter(part => part.type === 'source')).toHaveLength(1)
		expect(parts.some(part => part.type === 'raw')).toBe(false)

		const usage = deepseekPlatform.usage({ model: 'deepseek-flash', steps, at: new Date('2026-11-21T12:00:00Z') })
		expect(usage.title).toBe('DeepSeek V4.1 changes')
		expect(usage.cachedInputTokens).toBe(4096)
		// Saturday, off-peak: 9078 miss × 0.15 + 4096 hit × 0.003 + 1686 out × 0.60, per 1M tokens.
		expect(usage.costUsd).toBeCloseTo((9078 * 0.15 + 4096 * 0.003 + 1686 * 0.60) / 1e6, 12)
	})

	test('peak hours are 01–04 and 06–10 UTC on weekdays', () => {
		expect(isPeak(new Date('2026-11-23T01:00:00Z'))).toBe(true) // Monday
		expect(isPeak(new Date('2026-11-23T03:59:00Z'))).toBe(true)
		expect(isPeak(new Date('2026-11-23T04:00:00Z'))).toBe(false)
		expect(isPeak(new Date('2026-11-23T06:00:00Z'))).toBe(true)
		expect(isPeak(new Date('2026-11-23T10:00:00Z'))).toBe(false)
		expect(isPeak(new Date('2026-11-21T07:00:00Z'))).toBe(false) // Saturday
	})

	test('prices: peak doubles off-peak, an override wins, unknown models have none', () => {
		const peak = deepseekPrice('deepseek-v4-pro', new Date('2026-11-23T07:00:00Z'))!
		const offPeak = deepseekPrice('deepseek-v4-pro', new Date('2026-11-23T12:00:00Z'))!
		expect(peak).toEqual({ cacheRead: 0.044, input: 1.32, output: 3.96 })
		expect(offPeak.output).toBeCloseTo(1.98)
		expect(deepseekPrice('deepseek-v4-pro', new Date(), { input: 1, output: 2 })).toEqual({ input: 1, output: 2, cacheRead: 1 })
		expect(deepseekPrice('deepseek-next', new Date())).toBeNull()
	})
})
