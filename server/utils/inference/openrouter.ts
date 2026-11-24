import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { ToolSet } from 'ai'
import { z } from 'zod'
import type { CatalogEndpoint, CatalogModel, InferencePlatform, Pricing } from './types'
import { sumTokens } from './usage'

const BASE_URL = 'https://openrouter.ai/api/v1'

interface OpenRouterPricing { prompt: string, completion: string, input_cache_read?: string }

interface OpenRouterModel {
	id: string
	name: string
	context_length: number | null
	architecture: { input_modalities: string[], output_modalities: string[] }
	pricing: OpenRouterPricing
	top_provider: { max_completion_tokens: number | null }
	supported_parameters: string[]
	reasoning?: { supported_efforts?: string[] | null, default_effort?: string, default_enabled?: boolean, mandatory?: boolean }
}

interface OpenRouterEndpoint {
	tag: string
	provider_name: string
	quantization: string | null
	status: number
	uptime_last_30m: number | null
	uptime_last_1d: number | null
	context_length: number | null
	max_completion_tokens: number | null
	pricing: OpenRouterPricing
}

// Every effort the gateway accepts, for models whose `supported_efforts` is `null`.
const ALL_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** OpenRouter prices are decimal strings in USD per token. */
function perMillion(usdPerToken: string | undefined): number | undefined {
	return usdPerToken == null ? undefined : Number(usdPerToken) * 1e6
}

function toPricing(pricing: OpenRouterPricing): Pricing | null {
	const input = perMillion(pricing.prompt)
	const output = perMillion(pricing.completion)
	if (input === undefined || output === undefined || input < 0 || output < 0) return null
	return { input, output, cacheRead: perMillion(pricing.input_cache_read) }
}

export function toOpenRouterModel(model: OpenRouterModel): CatalogModel {
	const { reasoning } = model
	return {
		id: model.id,
		name: model.name,
		vendor: model.id.split('/')[0]!,
		contextLength: model.context_length,
		maxOutputTokens: model.top_provider.max_completion_tokens,
		// `file` (PDFs) for every model: OpenRouter's file-parser plugin turns PDFs into text when the model cannot read them.
		inputModalities: [...model.architecture.input_modalities.filter(m => m === 'text' || m === 'image'), 'file'],
		outputModalities: model.architecture.output_modalities,
		// The `openrouter:web_search` server tool goes through tool calling.
		webSearch: model.supported_parameters.includes('tools'),
		supportedParameters: model.supported_parameters,
		reasoning: reasoning ? { mandatory: !!reasoning.mandatory, defaultEnabled: !!reasoning.default_enabled } : null,
		// Per OpenRouter: `supported_efforts` null means every effort, omitted means only on/off.
		reasoningLevels: reasoning && 'supported_efforts' in reasoning ? (reasoning.supported_efforts ?? ALL_EFFORTS) : [],
		defaultReasoningLevel: reasoning?.default_effort ?? null,
		pricing: toPricing(model.pricing),
	}
}

export function toOpenRouterEndpoint(endpoint: OpenRouterEndpoint): CatalogEndpoint {
	return {
		tag: endpoint.tag,
		name: endpoint.provider_name,
		quantization: endpoint.quantization,
		status: endpoint.status,
		uptime30m: endpoint.uptime_last_30m,
		uptime1d: endpoint.uptime_last_1d,
		contextLength: endpoint.context_length,
		maxOutputTokens: endpoint.max_completion_tokens,
		pricing: toPricing(endpoint.pricing),
	}
}

async function get<T>(path: string, apiKey: string): Promise<T> {
	const response = await fetch(`${BASE_URL}${path}`, { headers: { Authorization: `Bearer ${apiKey}` } })
	if (!response.ok) throw new Error(`OpenRouter ${path} answered ${response.status}`)
	return await response.json() as T
}

/** Maps a chat's reasoning level onto OpenRouter's `reasoning` option. */
function reasoningOption(level: string | undefined) {
	if (level === undefined) return undefined
	if (level === 'none') return { enabled: false }
	if (level === 'on') return { enabled: true }
	return { effort: level }
}

interface OpenRouterMetadata {
	provider?: string
}

// OpenRouter's usage object, as it arrives in `usage.raw` and in the transcription response.
const usageCostSchema = z.object({
	cost: z.number(),
	is_byok: z.boolean().optional(),
	cost_details: z.object({ upstream_inference_cost: z.number().nullish() }).nullish(),
})

/**
 * What a call cost. `cost` is what OpenRouter charged; when the call ran on a provider key stored in the
 * OpenRouter account (BYOK), that provider's own charge comes on top, in `upstream_inference_cost`.
 * `null` when no cost was reported.
 */
function openrouterCost(raw: unknown): number | null {
	const usage = usageCostSchema.safeParse(raw).data
	if (!usage) return null
	return usage.cost + (usage.is_byok ? usage.cost_details?.upstream_inference_cost ?? 0 : 0)
}

export const openrouterPlatform: InferencePlatform = {
	id: 'openrouter',
	capabilities: { providerRouting: true, safetyCheck: false, nativeTitle: false, sttModel: true, decisions: true },

	async checkKey(apiKey) {
		const response = await fetch(`${BASE_URL}/key`, { headers: { Authorization: `Bearer ${apiKey}` } })
		if (response.status === 401 || response.status === 403) return false
		if (!response.ok) throw new Error(`OpenRouter /key answered ${response.status}`)
		return true
	},

	async listModels(apiKey) {
		const { data } = await get<{ data: OpenRouterModel[] }>('/models', apiKey)
		return data.filter(m => m.architecture.output_modalities.includes('text')).map(toOpenRouterModel)
	},

	async listSttModels(apiKey) {
		const { data } = await get<{ data: OpenRouterModel[] }>('/models?output_modalities=transcription', apiKey)
		// OpenRouter prices transcription per second of audio, in `pricing.prompt`.
		return data.map(model => ({
			...toOpenRouterModel(model),
			inputModalities: ['audio'],
			outputModalities: ['text'],
			pricing: null,
			pricePerMinute: model.pricing.prompt ? Number(model.pricing.prompt) * 60 : null,
		}))
	},

	async listDecisionModels(apiKey) {
		const { data } = await get<{ data: OpenRouterModel[] }>('/models?output_modalities=decisions', apiKey)
		return data.map(toOpenRouterModel)
	},

	async listEndpoints(apiKey, modelId) {
		const { data } = await get<{ data: { endpoints: OpenRouterEndpoint[] } }>(`/models/${modelId}/endpoints`, apiKey)
		return data.endpoints.map(toOpenRouterEndpoint)
	},

	prepare(input) {
		const openrouter = createOpenRouter({ apiKey: input.apiKey })
		const providers = input.providers?.length ? input.providers : undefined
		// Endpoint tags in the user's order, the ranking for automatic routing, and zero data retention.
		const provider = {
			...(providers && { only: providers, order: providers, allow_fallbacks: input.allowFallbacks ?? true }),
			...(input.providerSort && { sort: input.providerSort }),
			...(input.zdr && { zdr: true }),
		}
		// Options must stay unset: the helper flattens them, while OpenRouter expects them under `parameters`.
		const tools: ToolSet = input.webSearch ? { web_search: openrouter.tools.webSearch({}) } : {}
		return {
			// PDFs are parsed with the free `cloudflare-ai` engine; the default `mistral-ocr` is billed per page.
			model: openrouter.chat(input.model, { plugins: [{ id: 'file-parser', pdf: { engine: 'cloudflare-ai' } }] }),
			tools,
			providerOptions: {
				openrouter: {
					...(Object.keys(provider).length && { provider }),
					...(input.reasoningLevel !== undefined && { reasoning: reasoningOption(input.reasoningLevel) }),
					// Not AI SDK settings; the provider spreads these into the request body as they are.
					...(input.minP !== undefined && { min_p: input.minP }),
					...(input.topA !== undefined && { top_a: input.topA }),
					...(input.repetitionPenalty !== undefined && { repetition_penalty: input.repetitionPenalty }),
					user: input.userId,
				},
			},
			temperature: input.temperature,
			topP: input.topP,
			topK: input.topK,
			frequencyPenalty: input.frequencyPenalty,
			presencePenalty: input.presencePenalty,
			maxOutputTokens: input.maxOutputTokens,
		}
	},

	usage({ steps }) {
		let costUsd: number | null = 0
		let provider: string | undefined
		for (const step of steps) {
			const cost = openrouterCost(step.usage.raw)
			costUsd = costUsd === null || cost === null ? null : costUsd + cost
			provider = (step.providerMetadata?.openrouter as OpenRouterMetadata | undefined)?.provider ?? provider
		}
		return { provider, costUsd, ...sumTokens(steps) }
	},

	// https://openrouter.ai/docs/guides/overview/multimodal/stt: JSON with base64 audio; the response carries the cost.
	async transcribe({ apiKey, wav, model }) {
		const response = await fetch(`${BASE_URL}/audio/transcriptions`, {
			method: 'POST',
			headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ model, input_audio: { data: Buffer.from(wav).toString('base64'), format: 'wav' } }),
		})
		if (!response.ok) throw new Error(`OpenRouter transcription answered ${response.status}: ${await response.text()}`)
		const { text, usage } = await response.json() as { text: string, usage?: unknown }
		return { text, costUsd: openrouterCost(usage) }
	},
}
