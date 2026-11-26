import type { SharedV4ProviderOptions } from '@ai-sdk/provider'
import type { LanguageModel, LanguageModelUsage, ProviderMetadata, ToolSet } from 'ai'
import type { ChatSettings, ModelParams } from '../../../shared/utils/chat'
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
	/** What the model can produce, e.g. `text`, `image`. */
	outputModalities: string[]
	/** Whether the web search toggle applies to this model. */
	webSearch: boolean
	supportedParameters: string[]
	/** `null`: no reasoning control. Non-null with empty `reasoningLevels`: an on/off toggle only. */
	reasoning: { mandatory: boolean, defaultEnabled: boolean } | null
	reasoningLevels: string[]
	defaultReasoningLevel: string | null
	pricing: Pricing | null
	/** Speech-to-text models only: USD per minute of audio. */
	pricePerMinute?: number | null
	/** Text-to-speech models only: USD per million characters read. */
	pricePerMillionChars?: number | null
	/** Image models only: USD per image, the cheapest of its endpoints. */
	pricePerImage?: number | null
	/** Text-to-speech models only: the voices it offers. */
	voices?: string[]
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

export interface TurnInput extends ModelParams, ChatSettings {
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
	/** `false` when the platform refuses the app's own tools (chart, file tools) in this turn. */
	appTools?: false
	providerOptions: SharedV4ProviderOptions
	temperature?: number
	topP?: number
	topK?: number
	frequencyPenalty?: number
	presencePenalty?: number
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
		/** Speech to text needs a model chosen in the settings (`sttModel`). */
		sttModel: boolean
		/** Decisions models can pick a group round's speakers (`decisionModel`). */
		decisions: boolean
		/** Text to speech needs a model chosen in the settings (`speechModel`); otherwise the platform has `voices`. */
		speechModel: boolean
		/** Image models can be chosen (`imageModel`); images are drawn on this platform whichever one answers. */
		images: boolean
	}
	/** Resolves false for a key the platform rejects; throws when the platform cannot be reached. */
	checkKey(apiKey: string): Promise<boolean>
	listModels(apiKey: string): Promise<CatalogModel[]>
	/** Speech-to-text models, for platforms where one is chosen (`capabilities.sttModel`). */
	listSttModels?(apiKey: string): Promise<CatalogModel[]>
	/** Decisions models (`capabilities.decisions`), for the `decisionModel` setting. */
	listDecisionModels?(apiKey: string): Promise<CatalogModel[]>
	/** Text-to-speech models with their voices, for platforms where one is chosen (`capabilities.speechModel`). */
	listSpeechModels?(apiKey: string): Promise<CatalogModel[]>
	/** Image models with their price per image (`capabilities.images`), for the `imageModel` setting. */
	listImageModels?(apiKey: string): Promise<CatalogModel[]>
	/** The voices of a platform without a speech model to choose, the first the default. */
	voices?: { id: string, name: string }[]
	listEndpoints?(apiKey: string, modelId: string): Promise<CatalogEndpoint[]>
	prepare(input: TurnInput): PreparedTurn
	/** `price` is an admin override for platforms that report no cost. */
	usage(input: { model: string, steps: FinishedStep[], price?: Pricing | null, at?: Date }): TurnUsage
	/**
	 * For platforms that take no PDF inline: upload it once (billed once) and refer to it by id.
	 * Remote ids belong to the account of the key that uploaded them.
	 */
	pdfUpload?: {
		upload(apiKey: string, pdf: { bytes: Uint8Array, name: string }): Promise<{ remoteId: string, expiresAt: Date | null }>
		/** The fields of a UI file part that refer to an uploaded PDF. */
		reference(remoteId: string): { mediaType: string, providerReference: Record<string, string> }
		remove(apiKey: string, remoteId: string): Promise<void>
	}
	/** Speech to text for a 16-bit PCM WAV clip; `model` is the `sttModel` setting where one is needed. */
	transcribe(input: { apiKey: string, wav: Uint8Array, model?: string }): Promise<{ text: string, costUsd: number | null }>
	/**
	 * Text to speech for one piece of text. `model` is the `speechModel` setting where one is needed, and
	 * `pricePerMillionChars` its catalog price, for platforms that report no cost.
	 */
	speak(input: { apiKey: string, text: string, voice: string, model?: string, pricePerMillionChars?: number | null }): Promise<{ audio: Uint8Array, mediaType: string, costUsd: number | null }>
}
