import { z } from 'zod'

/** Card fields kept as they came, for export: what the app does not use. Bounded, since it is stored per note. */
const keptSchema = z.record(z.string(), z.unknown())
	.refine(kept => JSON.stringify(kept).length <= 20_000, 'Too many kept card fields')

/**
 * A library's lorebook (plan section 2b): with `on`, its notes are sent by their keywords to the lanes that read the
 * library, and never offered to the file tools. Turning it off keeps the options.
 */
export const lorebookSchema = z.object({
	on: z.boolean(),
	/** How many of the latest messages are searched; `null`: the chat's auto-fetch setting. */
	scanDepth: z.number().int().min(0).max(100).nullable().optional(),
	/** Most characters of notes sent for one answer; `null`: the chat's auto-fetch setting. */
	maxChars: z.number().int().min(100).max(500_000).nullable().optional(),
	/** Sent notes are searched for more keywords, at most 3 passes. */
	recursive: z.boolean().optional(),
	kept: keptSchema.optional(),
})

export type Lorebook = z.infer<typeof lorebookSchema>

export const LORE_LOGICS = ['andAny', 'andAll', 'notAny', 'notAll'] as const
export const LORE_POSITIONS = ['before', 'after', 'depth'] as const
export const LORE_ROLES = ['system', 'user', 'assistant'] as const

/** A note's lorebook options (plan section 2b). Unset ones have the default noted. */
export const loreSchema = z.object({
	/** Off: never sent. Default on. */
	enabled: z.boolean(),
	/** Always sent, ahead of keyword matches. */
	constant: z.boolean(),
	/** "Also needs" keywords, combined by `logic`. */
	secondaryKeys: z.array(z.string().trim().min(1).max(100)).max(50),
	/** Default `andAny`. */
	logic: z.enum(LORE_LOGICS),
	/** `null`: case-insensitive. */
	caseSensitive: z.boolean().nullable(),
	/** `null`: whole words for plain Latin keywords, anywhere otherwise. */
	wholeWords: z.boolean().nullable(),
	/** `null`: the book's. */
	scanDepth: z.number().int().min(0).max(100).nullable(),
	/** Sent in this order, lowest first. Default 100. */
	order: z.number().int().min(-1_000_000).max(1_000_000),
	/** The budget drops the lowest first; `null`: the order. */
	priority: z.number().int().min(-1_000_000).max(1_000_000).nullable(),
	/** `before`/`after` the instructions, at a `depth` in the conversation; `null`: with auto-fetched files. */
	position: z.enum(LORE_POSITIONS).nullable(),
	/** Messages up from the end, for `depth`. Default 4. */
	depth: z.number().int().min(0).max(1000),
	/** Who says it, for `depth`. Default `system`, sent as a user message. */
	role: z.enum(LORE_ROLES),
	/** Its text is not searched for more keywords. */
	preventRecursion: z.boolean(),
	/** Not sent because another note named it. */
	excludeRecursion: z.boolean(),
	/** Only sent because another note named it. */
	delayUntilRecursion: z.boolean(),
	/** Comma-separated groups: one entry of a group is sent. */
	group: z.string().trim().max(200),
	/** Wins its group. */
	groupOverride: z.boolean(),
	/** Its chance of winning its group. Default 100. */
	groupWeight: z.number().int().min(1).max(10_000),
	/** Its group goes to the entry with the most matched keywords first. */
	groupScoring: z.boolean(),
	/** The chance, in percent, it is sent when it matches. Default 100. */
	probability: z.number().int().min(0).max(100),
	/** Stays this many messages after it was sent. */
	sticky: z.number().int().min(0).max(1000),
	/** Then waits this many messages before it can be sent again. */
	cooldown: z.number().int().min(0).max(1000),
	/** Not sent before the chat has this many messages. */
	delay: z.number().int().min(0).max(1000),
	/** Also found by the words of its text (full-text search). */
	fuzzy: z.boolean(),
	/** Also searches the Character's instructions. */
	scanInstructions: z.boolean(),
	/** Also searches the user's Character. */
	scanUserCharacter: z.boolean(),
	kept: keptSchema,
}).partial()

export type Lore = z.infer<typeof loreSchema>
