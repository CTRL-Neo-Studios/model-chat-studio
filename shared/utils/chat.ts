import { z } from 'zod'

/** Per-chat model settings, stored in `chat.params` and sent with each turn. */
export const chatParamsSchema = z.object({
	model: z.string().min(1).optional(),
	/** OpenRouter endpoint tags, e.g. `deepinfra/fp4/flex`. Empty means automatic routing. */
	providers: z.array(z.string().min(1)).optional(),
	allowFallbacks: z.boolean().optional(),
	temperature: z.number().min(0).max(2).optional(),
	topP: z.number().gt(0).max(1).optional(),
	maxOutputTokens: z.number().int().positive().optional(),
	/** `none` turns reasoning off; other values come from the model's catalog entry. */
	reasoningLevel: z.string().min(1).optional(),
	webSearch: z.boolean().optional(),
})

export type ChatParams = z.infer<typeof chatParamsSchema>

/** Stored on assistant messages and sent to the client as `UIMessage.metadata`. */
export interface MessageMetadata {
	platform: 'openrouter' | 'deepseek'
	model: string
	/** The upstream provider that served the turn, as the platform names it. */
	provider?: string
	inputTokens?: number
	cachedInputTokens?: number
	outputTokens?: number
	reasoningTokens?: number
	/** `null` when the platform reported no cost and no price is known. */
	costUsd?: number | null
	/** The safety check withheld the answer; the stored text is a notice. */
	refused?: boolean
}
