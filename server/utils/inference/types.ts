import type { LanguageModel, LanguageModelUsage, ProviderMetadata, ToolSet } from 'ai'
import type { ChatParams } from '../../../shared/utils/chat'
import type { InferencePlatformId } from '../core/settings'

/** USD per 1M tokens. */
export interface Pricing {
	input: number
	cacheRead?: number
	output: number
}

export interface CatalogModel {
	id: string
	name: string
	vendor: string
	contextLength: number | null
	maxOutputTokens: number | null
	/** Subset of `text`, `image`, `file`. `file` means PDFs are accepted. */
	inputModalities: string[]
	/** Whether the web search toggle applies to this model. */
	webSearch: boolean
	supportedParameters: string[]
	/** `null`: no reasoning control. Non-null with empty `reasoningLevels`: an on/off toggle only. */
	reasoning: { mandatory: boolean, defaultEnabled: boolean } | null
	reasoningLevels: string[]
	defaultReasoningLevel: string | null
	pricing: Pricing | null
}

/** An upstream provider serving one OpenRouter model. */
export interface CatalogEndpoint {
	/** What routing sends, e.g. `deepinfra/fp4/flex`. */
	tag: string
	/** What is shown, and what the platform reports as the provider that served a turn. */
	name: string
	quantization: string | null
	/** 0 is healthy; negative is degraded. */
	status: number
	uptime30m: number | null
	uptime1d: number | null
	contextLength: number | null
	maxOutputTokens: number | null
	pricing: Pricing | null
}

export interface TurnInput extends Omit<ChatParams, 'model'> {
	apiKey: string
	model: string
	userId: string
	/** The first turn of a chat; DeepSeek generates the chat title on it. */
	firstTurn: boolean
	/** DeepSeek's content review (admin setting). */
	safetyCheck: boolean
}

/** Spread into `streamText`, next to the messages, system prompt and app tools. */
export interface PreparedTurn {
	model: LanguageModel
	tools: ToolSet
	providerOptions: Record<string, Record<string, unknown>>
	temperature?: number
	topP?: number
	maxOutputTokens?: number
}

/** The parts of each finished step that usage accounting reads. */
export interface FinishedStep {
	usage: LanguageModelUsage
	providerMetadata?: ProviderMetadata
}

export interface TurnUsage {
	/** The upstream provider that served the turn, as the platform names it. */
	provider?: string
	inputTokens: number
	cachedInputTokens: number
	outputTokens: number
	reasoningTokens: number
	/** `null` when the platform reported no cost and no price is known. */
	costUsd: number | null
	/** A chat title, when the platform generated one (DeepSeek's title flag). */
	title?: string
}

export interface InferencePlatform {
	id: InferencePlatformId
	capabilities: {
		/** Upstream provider picker and routing. */
		providerRouting: boolean
		safetyCheck: boolean
		/** Titles come with the first turn instead of from a separate call. */
		nativeTitle: boolean
	}
	/** Resolves false for a key the platform rejects; throws when the platform cannot be reached. */
	checkKey(apiKey: string): Promise<boolean>
	listModels(apiKey: string): Promise<CatalogModel[]>
	listEndpoints?(apiKey: string, modelId: string): Promise<CatalogEndpoint[]>
	prepare(input: TurnInput): PreparedTurn
	/** `price` is an admin override for platforms that report no cost. */
	usage(input: { model: string, steps: FinishedStep[], price?: Pricing | null, at?: Date }): TurnUsage
}
