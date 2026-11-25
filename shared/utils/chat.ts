import { z } from 'zod'

/** A lane's or profile's model settings, stored in `chatModel.params` and `modelProfile.params`. */
export const modelParamsSchema = z.object({
	/** OpenRouter endpoint tags, e.g. `deepinfra/fp4/flex`. Empty means automatic routing. */
	providers: z.array(z.string().min(1)).optional(),
	allowFallbacks: z.boolean().optional(),
	/** OpenRouter: how to rank providers when routing automatically. */
	providerSort: z.enum(['price', 'throughput', 'latency']).optional(),
	/** OpenRouter: only providers that do not retain prompts. */
	zdr: z.boolean().optional(),
	temperature: z.number().min(0).max(2).optional(),
	topP: z.number().gt(0).max(1).optional(),
	topK: z.number().int().min(0).max(1000).optional(),
	minP: z.number().min(0).max(1).optional(),
	topA: z.number().min(0).max(1).optional(),
	frequencyPenalty: z.number().min(-2).max(2).optional(),
	presencePenalty: z.number().min(-2).max(2).optional(),
	repetitionPenalty: z.number().gt(0).max(2).optional(),
	maxOutputTokens: z.number().int().positive().optional(),
	/** `none` turns reasoning off; other values come from the model's catalog entry. */
	reasoningLevel: z.string().min(1).optional(),
})

export type ModelParams = z.infer<typeof modelParamsSchema>

/** Settings that apply to every lane of a chat, stored in `chat.settings`. */
export const chatSettingsSchema = z.object({
	webSearch: z.boolean().optional(),
	/** How several lanes' answers to one message are shown: side by side (default) or one under another. */
	answerLayout: z.enum(['columns', 'stack']).optional(),
	/** How many messages of each lane's thread are sent (after its latest summary); `null` or absent: all. */
	memoryLength: z.number().int().min(1).max(10_000).nullable().optional(),
	/** Chats with a library: files and notes fetched by their tags (and, with `fuzzy`, by their text). Unset fields use `AUTO_FETCH_DEFAULTS`. */
	autoFetch: z.object({
		enabled: z.boolean(),
		/** Most entries fetched for one answer. */
		maxEntries: z.number().int().min(1).max(20),
		/** How many of the latest messages (of the `scan` roles) are searched for tags. */
		scanMessages: z.number().int().min(1).max(50),
		/** What is searched: user messages, answers, the lane's system prompt. */
		scan: z.array(z.enum(['user', 'assistant', 'system'])).max(3),
		/** Also search the scanned words in names, tags and text (Fuse.js). */
		fuzzy: z.boolean(),
		/** Only entries inside these folders; empty: the whole library. */
		folders: z.array(z.uuid()).max(50),
		/** Most characters of text fetched for one answer. */
		maxChars: z.number().int().min(1000).max(500_000),
	}).partial().optional(),
	/** Chats with a library: the model may list, search and read its notes and text files. Absent: on. */
	fileTools: z.boolean().optional(),
	/** The model may draw images (`generate_image`), when an image model is set and an OpenRouter key is stored. Absent: off. */
	images: z.boolean().optional(),
})

export type ChatSettings = z.infer<typeof chatSettingsSchema>
export type AutoFetchSettings = Required<NonNullable<ChatSettings['autoFetch']>>

export const AUTO_FETCH_DEFAULTS: AutoFetchSettings = { enabled: true, maxEntries: 5, scanMessages: 5, scan: ['user'], fuzzy: false, folders: [], maxChars: 60_000 }

/** The colors a lane can be labelled with: Tailwind palette names. */
export const LANE_COLORS = ['red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'] as const
export type LaneColor = typeof LANE_COLORS[number]

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
	/** Who the lane is: its instructions replace the system prompt; `null`: none. */
	characterId: z.uuid().nullable(),
})

export type LaneFields = z.infer<typeof laneFieldsSchema>

/** A lane to create: lane fields, optionally starting from a profile (`profileId`) that they are applied over. */
export const newLaneSchema = laneFieldsSchema.partial().extend({ profileId: z.uuid().optional() })

export type NewLane = z.infer<typeof newLaneSchema>

/** The editable fields of a model profile: a model with its settings, used to start lanes. */
export const profileFieldsSchema = z.object({
	name: z.string().trim().min(1).max(60),
	color: z.enum(LANE_COLORS).nullable(),
	modelId: z.string().min(1).max(200),
	/** `null` uses the default instructions. */
	systemPrompt: z.string().trim().max(20_000).nullable(),
	params: modelParamsSchema,
	/** The Character lanes started from it begin with; `null`: none. */
	characterId: z.uuid().nullable(),
})

export type ProfileFields = z.infer<typeof profileFieldsSchema>

/**
 * Stored on messages and sent to the client as `UIMessage.metadata`: on answers and summaries, who wrote them and
 * at what cost; on a group chat's user message, who answered it.
 */
export interface MessageMetadata {
	/** Answers and summaries only. */
	platform?: 'openrouter' | 'deepseek'
	model?: string
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
	/** The lane that answered, as it was then, so the answer keeps its label after the lane changes or goes. */
	lane?: { name: string, color: LaneColor | null }
	/** From the request to the end of the answer. */
	durationMs?: number
	/** 1 for the first answer, then one more per regenerate (capped by `maxRegenerations`). */
	attempt?: number
	/** A `/compact` summary (role `system`): of a lane's thread up to it, or in a group chat of the shared thread. */
	kind?: 'summary'
	/** Library files and notes auto-fetched for this answer, by path. */
	fetched?: { entryId: string, name: string }[]
	/** A group chat's user message: the lanes that answered it, in speaking order. */
	speakers?: string[]
	/** A Character's greeting, written when the chat started: it answers no message, and is not regenerated. */
	greeting?: boolean
}

/**
 * One piece of what a lane's answer was given, in the order sent: what the conversation overview shows. Prompts
 * are copied (they are short); messages and files are referenced by id.
 */
export interface ContextBlock {
	/**
	 * `reference`: a library file or note, named with "@" in the message before it or fetched by `autoFetch`, the
	 * added message of auto-fetched files (or where a structure profile puts them). `profile`: a structure profile's
	 * message or files block. `note`: the lane's Character's closing note. `lore`: a lorebook note, where its position
	 * put it; the lane's later answers read these for sticky and cooldown.
	 */
	kind: 'instructions' | 'omitted' | 'summary' | 'message' | 'reference' | 'autoFetch' | 'profile' | 'note' | 'lore'
	role: 'system' | 'user' | 'assistant'
	label: string
	/** Characters of text; attachments are not counted. */
	size: number
	/** Instructions and summaries. */
	text?: string
	messageId?: string
	/** `reference` and `lore`: the library entry. */
	entryId?: string
	/** `lore`: kept by its `sticky` option rather than matched. */
	sticky?: boolean
	/** `omitted`: how many earlier messages the memory setting left out. */
	count?: number
}
