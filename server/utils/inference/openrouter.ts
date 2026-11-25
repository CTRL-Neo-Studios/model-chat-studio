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

/**
 * Draws one image with OpenRouter's Images API (`POST /images`, spike M): the bytes, their type, and the cost the
 * response reports. `aspectRatio` is passed on when given; the provider clamps it to what it supports.
 */
export async function openrouterImage(input: { apiKey: string, model: string, prompt: string, aspectRatio?: string }) {
	const response = await fetch(`${BASE_URL}/images`, {
		method: 'POST',
		headers: { 'Authorization': `Bearer ${input.apiKey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ model: input.model, prompt: input.prompt, ...(input.aspectRatio && { aspect_ratio: input.aspectRatio }) }),
	})
	if (!response.ok) throw new Error(`OpenRouter images answered ${response.status}: ${(await response.text()).slice(0, 500)}`)
	const { data, usage } = await response.json() as { data: { b64_json?: string, media_type?: string }[], usage?: unknown }
	const image = data[0]
	if (!image?.b64_json) throw new Error('OpenRouter images returned no image')
	return { bytes: Uint8Array.from(Buffer.from(image.b64_json, 'base64')), mediaType: image.media_type ?? 'image/png', costUsd: openrouterCost(usage) }
}

export const openrouterPlatform: InferencePlatform = {
	id: 'openrouter',
	capabilities: { providerRouting: true, safetyCheck: false, nativeTitle: false, sttModel: true, decisions: true, speechModel: true, images: true },

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

	// The voices are in the speech models list, the price (per character, in `pricing.prompt`) in the models list.
	// Only models that publish their voices and return MP3 are offered (spike L).
	async listSpeechModels(apiKey) {
		type SpeechModel = { id: string, output_modalities: { type: string, supported_parameters?: { voice?: { values?: string[] }, response_format?: { values?: string[] } } }[] }
		const [{ data: speech }, { data: priced }] = await Promise.all([
			get<{ data: SpeechModel[] }>('/audio/speech/models', apiKey),
			get<{ data: OpenRouterModel[] }>('/models?output_modalities=speech', apiKey),
		])
		const byId = Object.fromEntries(priced.map(model => [model.id, model]))
		return speech.flatMap((model) => {
			const output = model.output_modalities.find(modality => modality.type === 'speech')?.supported_parameters
			const voices = output?.voice?.values ?? []
			const listed = byId[model.id]
			if (!listed || !voices.length || !output?.response_format?.values?.includes('mp3')) return []
			return [{
				...toOpenRouterModel(listed),
				inputModalities: ['text'],
				outputModalities: ['audio'],
				pricing: null,
				pricePerMillionChars: listed.pricing.prompt ? Number(listed.pricing.prompt) * 1e6 : null,
				voices,
			}]
		})
	},

	// The image models list has no prices; each model's endpoints do, per image or per megapixel (one is shown).
	// Fetched a few at a time; `getKindCatalog` keeps the result for an hour.
	async listImageModels(apiKey) {
		type ImageModel = { id: string, name: string, architecture: { input_modalities: string[] }, supported_parameters: Record<string, unknown> | null, endpoints: string }
		type Endpoints = { endpoints?: { pricing?: { billable: string, unit: string, cost_usd: number }[] | null }[] }
		const { data } = await get<{ data: ImageModel[] }>('/images/models', apiKey)
		const prices: Record<string, number | null> = {}
		for (let at = 0; at < data.length; at += 8) {
			await Promise.all(data.slice(at, at + 8).map(async (model) => {
				const path = model.endpoints.replace(/^\/api\/v1/, '')
				const { endpoints = [] } = await get<Endpoints>(path, apiKey).catch(() => ({ endpoints: [] }))
				const costs = endpoints.flatMap(endpoint => (endpoint.pricing ?? []).filter(line => line.billable === 'output_image' && (line.unit === 'image' || line.unit === 'megapixel')).map(line => line.cost_usd))
				prices[model.id] = costs.length ? Math.min(...costs) : null
			}))
		}
		return data.map(model => ({
			id: model.id,
			name: model.name,
			vendor: model.id.split('/')[0] ?? '',
			contextLength: null,
			maxOutputTokens: null,
			inputModalities: model.architecture.input_modalities.filter(modality => modality === 'text' || modality === 'image'),
			outputModalities: ['image'],
			webSearch: false,
			supportedParameters: Object.keys(model.supported_parameters ?? {}),
			reasoning: null,
			reasoningLevels: [],
			defaultReasoningLevel: null,
			pricing: null,
			pricePerImage: prices[model.id] ?? null,
		}))
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

	// https://openrouter.ai/docs/guides/overview/multimodal/tts: the response is the audio and says nothing of the
	// cost, and no generation record appears for it (spike L), so the cost is the catalog price per character.
	async speak({ apiKey, text, voice, model, pricePerMillionChars }) {
		const response = await fetch(`${BASE_URL}/audio/speech`, {
			method: 'POST',
			headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ model, input: text, voice, response_format: 'mp3' }),
		})
		if (!response.ok) throw new Error(`OpenRouter speech answered ${response.status}: ${await response.text()}`)
		return {
			audio: new Uint8Array(await response.arrayBuffer()),
			mediaType: response.headers.get('content-type') ?? 'audio/mpeg',
			costUsd: pricePerMillionChars == null ? null : pricePerMillionChars * text.length / 1e6,
		}
	},
}
