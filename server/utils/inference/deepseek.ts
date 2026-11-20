import { createDeepSeek } from '@ai-sdk/deepseek'
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { wrapLanguageModel } from 'ai'
import { z } from 'zod'
import type { CatalogModel, InferencePlatform, Pricing, TurnInput } from './types'
import { sumTokens } from './usage'

const BASE_URL = 'https://api.deepseek.com'

interface DeepSeekModel {
	id: string
	name?: string
	context_window?: number
	max_output_tokens?: number
	input_modalities?: string[]
	effort?: { supported_levels: string[], default_level?: string }
}

/** Web search, images and PDFs are documented for `deepseek-flash` only. */
const CHATBOT_TOOL_MODELS: Record<string, true> = { 'deepseek-flash': true }

/**
 * USD per 1M tokens from https://api-docs.deepseek.com/quick_start/pricing (read 2026-11-20).
 * Off-peak prices are half of these.
 */
const PEAK_PRICES: Record<string, Required<Pricing>> = {
	'deepseek-flash': { cacheRead: 0.006, input: 0.30, output: 1.20 },
	'deepseek-v4-pro': { cacheRead: 0.044, input: 1.32, output: 3.96 },
}

/**
 * Peak is 01:00–04:00 and 06:00–10:00 UTC, Monday to Friday. Chinese public holidays are off-peak too;
 * they are ignored here, which overcounts slightly and never undercounts.
 */
export function isPeak(at: Date): boolean {
	const day = at.getUTCDay()
	const hour = at.getUTCHours()
	return day >= 1 && day <= 5 && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10))
}

/** The price in effect for a model at a time; an admin override wins and has no peak split. */
export function deepseekPrice(model: string, at: Date, override?: Pricing | null): Required<Pricing> | null {
	if (override) return { ...override, cacheRead: override.cacheRead ?? override.input }
	const peak = PEAK_PRICES[model]
	if (!peak) return null
	const factor = isPeak(at) ? 1 : 0.5
	return { cacheRead: peak.cacheRead * factor, input: peak.input * factor, output: peak.output * factor }
}

export function toDeepSeekModel(model: DeepSeekModel): CatalogModel {
	return {
		id: model.id,
		name: model.name ?? model.id,
		vendor: 'deepseek',
		contextLength: model.context_window ?? null,
		maxOutputTokens: model.max_output_tokens ?? null,
		// PDFs go through DeepSeek's file parsing, which only these models accept; the API does not list them.
		inputModalities: [
			...(model.input_modalities ?? ['text']).filter(m => m === 'text' || m === 'image'),
			...(CHATBOT_TOOL_MODELS[model.id] ? ['file'] : []),
		],
		webSearch: !!CHATBOT_TOOL_MODELS[model.id],
		// The API lists none; DeepSeek ignores temperature and top_p while thinking, searching or reviewing.
		supportedParameters: ['max_tokens', 'temperature', 'top_p', 'reasoning', 'tools'],
		reasoning: model.effort ? { mandatory: false, defaultEnabled: true } : null,
		// `none` turns thinking off; the API does not list it.
		reasoningLevels: model.effort ? ['none', ...model.effort.supported_levels] : [],
		defaultReasoningLevel: model.effort?.default_level ?? null,
		pricing: PEAK_PRICES[model.id] ?? null,
	}
}

// DeepSeek's extension fields on the last Chat Completions chunk, which the provider does not parse.
const lastChunkSchema = z.object({
	choices: z.array(z.object({
		delta: z.object({
			title: z.string().optional(),
			annotations: z.array(z.object({ url_citation: z.object({ url: z.string(), title: z.string().optional() }) })).optional(),
		}).optional(),
	})).optional(),
})

/**
 * `@ai-sdk/deepseek` on Chat Completions, plus two pieces of glue:
 * - a `fetch` wrapper that adds DeepSeek's web tools, `title` and `safety_check` to the body, since the
 *   provider drops them when passed as options;
 * - a middleware that turns the last chunk's citations into `source` parts and its title into
 *   `providerMetadata.deepseek.title`.
 */
function deepseekModel(input: TurnInput) {
	const webSearch = !!input.webSearch && !!CHATBOT_TOOL_MODELS[input.model]
	const provider = createDeepSeek({
		apiKey: input.apiKey,
		fetch: async (url, init) => {
			if (typeof init?.body !== 'string') return fetch(url, init)
			const body = JSON.parse(init.body)
			if (input.safetyCheck) body.safety_check = { level: 'high' }
			if (input.firstTurn) body.title = { enabled: true }
			if (webSearch) body.tools = [...(body.tools ?? []), { type: 'deepseek_web_search' }, { type: 'deepseek_read_url' }]
			return fetch(url, { ...init, body: JSON.stringify(body) })
		},
	})

	return wrapLanguageModel({
		model: provider.chat(input.model),
		middleware: {
			specificationVersion: 'v4',
			transformParams: async ({ params }) => ({ ...params, includeRawChunks: true }),
			wrapStream: async ({ doStream }) => {
				const { stream, ...rest } = await doStream()
				let title: string | undefined
				let citation = 0
				return {
					...rest,
					stream: stream.pipeThrough(new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
						transform(part, controller) {
							if (part.type !== 'raw') {
								if (part.type === 'finish' && title) {
									part = { ...part, providerMetadata: { ...part.providerMetadata, deepseek: { ...part.providerMetadata?.deepseek, title } } }
								}
								controller.enqueue(part)
								return
							}
							// Raw chunks were only switched on for this; they are not passed on.
							const delta = lastChunkSchema.safeParse(part.rawValue).data?.choices?.[0]?.delta
							if (delta?.title) title = delta.title
							for (const annotation of delta?.annotations ?? []) {
								controller.enqueue({ type: 'source', sourceType: 'url', id: `citation-${citation++}`, url: annotation.url_citation.url, title: annotation.url_citation.title })
							}
						},
					})),
				}
			},
		},
	})
}

export const deepseekPlatform: InferencePlatform = {
	id: 'deepseek',
	capabilities: { providerRouting: false, safetyCheck: true, nativeTitle: true },

	async checkKey(apiKey) {
		const response = await fetch(`${BASE_URL}/models`, { headers: { Authorization: `Bearer ${apiKey}` } })
		if (response.status === 401 || response.status === 403) return false
		if (!response.ok) throw new Error(`DeepSeek /models answered ${response.status}`)
		return true
	},

	async listModels(apiKey) {
		const response = await fetch(`${BASE_URL}/models`, { headers: { Authorization: `Bearer ${apiKey}` } })
		if (!response.ok) throw new Error(`DeepSeek /models answered ${response.status}`)
		const { data } = await response.json() as { data: DeepSeekModel[] }
		return data.map(toDeepSeekModel)
	},

	prepare(input) {
		const level = input.reasoningLevel
		return {
			model: deepseekModel(input),
			tools: {},
			providerOptions: {
				deepseek: {
					...(level !== undefined && { thinking: { type: level === 'none' ? 'disabled' : 'enabled' } }),
					...(level !== undefined && level !== 'none' && { reasoningEffort: level }),
					// Isolates content review and the prompt cache per user.
					userId: input.userId,
				},
			},
			temperature: input.temperature,
			topP: input.topP,
			maxOutputTokens: input.maxOutputTokens,
		}
	},

	usage({ model, steps, price, at = new Date() }) {
		const tokens = sumTokens(steps)
		const rate = deepseekPrice(model, at, price)
		const costUsd = rate
			? ((tokens.inputTokens - tokens.cachedInputTokens) * rate.input + tokens.cachedInputTokens * rate.cacheRead + tokens.outputTokens * rate.output) / 1e6
			: null
		let title: string | undefined
		for (const step of steps) {
			const value = step.providerMetadata?.deepseek?.title
			if (typeof value === 'string') title = value
		}
		return { ...tokens, costUsd, title }
	},
}
