import { z } from 'zod'

/** A lane's model settings, stored in `chatModel.params`. */
export const modelParamsSchema = z.object({
	/** OpenRouter endpoint tags, e.g. `deepinfra/fp4/flex`. Empty means automatic routing. */
	providers: z.array(z.string().min(1)).optional(),
	allowFallbacks: z.boolean().optional(),
	temperature: z.number().min(0).max(2).optional(),
	topP: z.number().gt(0).max(1).optional(),
	maxOutputTokens: z.number().int().positive().optional(),
	/** `none` turns reasoning off; other values come from the model's catalog entry. */
	reasoningLevel: z.string().min(1).optional(),
})

export type ModelParams = z.infer<typeof modelParamsSchema>

/** Settings that apply to every lane of a chat, stored in `chat.settings`. */
export const chatSettingsSchema = z.object({
	webSearch: z.boolean().optional(),
})

export type ChatSettings = z.infer<typeof chatSettingsSchema>

/** The colors a lane can be labelled with: Tailwind palette names. */
export const LANE_COLORS = ['red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'] as const

/**
 * The editable fields of a lane (`chatModel`): one model answering in a chat.
 * `modelId` `null` is the active platform's default model; `name` `null` shows the model's name.
 */
export const laneFieldsSchema = z.object({
	name: z.string().trim().min(1).max(60).nullable(),
	color: z.enum(LANE_COLORS).nullable(),
	modelId: z.string().min(1).max(200).nullable(),
	systemPrompt: z.string().trim().max(20_000).nullable(),
	params: modelParamsSchema,
	enabled: z.boolean(),
})

export type LaneFields = z.infer<typeof laneFieldsSchema>

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
	/** The answer's text was edited by hand. */
	edited?: boolean
}
