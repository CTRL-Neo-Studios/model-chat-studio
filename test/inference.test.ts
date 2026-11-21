import { afterEach, describe, expect, test } from 'bun:test'
import { convertToModelMessages, streamText, type UIMessage } from 'ai'
import { deepseekPlatform, deepseekPrice, isPeak } from '../server/utils/inference/deepseek'
import { openrouterPlatform, toOpenRouterModel } from '../server/utils/inference/openrouter'
import type { InferencePlatform, TurnInput } from '../server/utils/inference/types'
import { wavDurationSeconds } from '../server/utils/inference/wav'
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

	test('sends sampling settings where OpenRouter reads them, and the ranking and retention choices with or without chosen providers', async () => {
		const bodies = captureFetch(openrouterChunks())
		await run(turn({ model: 'a/b', topK: 40, minP: 0.05, topA: 0.1, frequencyPenalty: 0.2, presencePenalty: -0.1, repetitionPenalty: 1.1, providerSort: 'price', zdr: true }))
		await run(turn({ model: 'a/b', providers: ['x/fp8'], providerSort: 'latency' }))
		expect(bodies[0]).toMatchObject({ top_k: 40, min_p: 0.05, top_a: 0.1, frequency_penalty: 0.2, presence_penalty: -0.1, repetition_penalty: 1.1, provider: { sort: 'price', zdr: true } })
		expect(bodies[1]!.provider).toEqual({ only: ['x/fp8'], order: ['x/fp8'], allow_fallbacks: true, sort: 'latency' })
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
		expect(toggleOnly.inputModalities).toEqual(['text', 'image', 'file'])
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

describe('Attachments and speech', () => {
	async function requestFor(platform: InferencePlatform, model: string, part: UIMessage['parts'][number]) {
		const bodies = captureFetch(platform === openrouterPlatform ? openrouterChunks() : deepseekChunks)
		const messages: UIMessage[] = [{ id: 'm', role: 'user', parts: [part, { type: 'text', text: 'Summarize.' }] }]
		await streamText({ ...platform.prepare(turn({ model })), messages: await convertToModelMessages(messages), maxRetries: 0 }).consumeStream()
		return bodies[0] as { messages: { content: unknown }[], plugins?: unknown }
	}

	test('a DeepSeek PDF goes by file id; OpenRouter gets it inline with the free parser', async () => {
		const reference = deepseekPlatform.pdfUpload!.reference('file-api-1')
		const deepseek = await requestFor(deepseekPlatform, 'deepseek-flash', { type: 'file', url: '/api/v1/files/x', ...reference })
		expect(deepseek.messages.at(-1)!.content).toContainEqual({ type: 'file', file_id: 'file-api-1' })

		const openrouter = await requestFor(openrouterPlatform, 'openai/gpt-5-mini', { type: 'file', mediaType: 'application/pdf', filename: 'a.pdf', url: 'data:application/pdf;base64,JVBERi0xLjQ=' })
		expect(openrouter.plugins).toEqual([{ id: 'file-parser', pdf: { engine: 'cloudflare-ai' } }])
		expect(JSON.stringify(openrouter.messages.at(-1)!.content)).toContain('JVBERi0xLjQ=')
	})

	test('DeepSeek uploads a PDF with `purpose` before `file`, and bills speech per started second', async () => {
		const forms: FormData[] = []
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			forms.push(await new Request(url, init).formData())
			return url.endsWith('/files') ? Response.json({ id: 'file-api-1' }) : Response.json({ text: 'hello', duration_ms: 3200 })
		}) as typeof fetch

		expect(await deepseekPlatform.pdfUpload!.upload('sk-test', { bytes: new Uint8Array([37, 80, 68, 70]), name: 'a.pdf' })).toMatchObject({ remoteId: 'file-api-1' })
		expect([...forms[0]!.keys()]).toEqual(['purpose', 'expires_after[anchor]', 'expires_after[seconds]', 'file'])

		const speech = await deepseekPlatform.transcribe({ apiKey: 'sk-test', wav: new Uint8Array(44) })
		expect(speech.text).toBe('hello')
		expect(speech.costUsd).toBeCloseTo(4 * 0.116 / 3600, 12)
	})

	test('OpenRouter sends speech as base64 WAV to the chosen model and reads the cost', async () => {
		let body: { model?: string, input_audio?: { data: string, format: string } } = {}
		globalThis.fetch = (async (_url: string, init?: RequestInit) => {
			body = JSON.parse(String(init?.body))
			return Response.json({ text: ' hello ', usage: { seconds: 1, cost: 0.0000075 } })
		}) as typeof fetch
		expect(await openrouterPlatform.transcribe({ apiKey: 'sk-test', wav: new Uint8Array([1, 2, 3]), model: 'openai/whisper-1' })).toEqual({ text: ' hello ', costUsd: 0.0000075 })
		expect(body).toEqual({ model: 'openai/whisper-1', input_audio: { data: 'AQID', format: 'wav' } })
	})

	test('reads the duration of a 16-bit PCM WAV and rejects anything else', () => {
		const wav = (bits: number, seconds: number, rate = 16000) => {
			const dataSize = seconds * rate * bits / 8
			const bytes = new Uint8Array(44 + dataSize)
			const view = new DataView(bytes.buffer)
			const ascii = (at: number, text: string) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
			ascii(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); ascii(8, 'WAVE')
			ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
			view.setUint32(24, rate, true); view.setUint32(28, rate * bits / 8, true); view.setUint16(32, bits / 8, true); view.setUint16(34, bits, true)
			ascii(36, 'data'); view.setUint32(40, dataSize, true)
			return bytes
		}
		expect(wavDurationSeconds(wav(16, 3))).toBe(3)
		expect(wavDurationSeconds(wav(16, 1, 48000))).toBe(1)
		expect(wavDurationSeconds(wav(8, 1))).toBeNull()
		expect(wavDurationSeconds(new TextEncoder().encode('not a wav at all'))).toBeNull()
	})
})
