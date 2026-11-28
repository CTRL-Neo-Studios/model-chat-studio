import { z } from 'zod'

export const STOPPED_REGENERATE_OPTIONS = ['keep-previous', 'keep-partial'] as const

/** A member's own preferences, stored in `user.preferences`. Unset or invalid values read as the default. */
export const userPreferencesSchema = z.object({
	/** What a regenerated answer stopped partway leaves: the answer it was replacing, or what had streamed. */
	stoppedRegenerate: z.enum(STOPPED_REGENERATE_OPTIONS).catch('keep-previous'),
	/** Who the member is in new chats, unless a chat picks another: one of their Characters or an instance one. */
	characterId: z.uuid().nullable().catch(null),
	/** The voice read-aloud uses, per platform (a voice id that platform offers); unset or gone: the platform's default. */
	voices: z.object({ openrouter: z.string().optional(), deepseek: z.string().optional() }).catch({}),
	/** A paste longer than this many characters asks: into the prompt as text, or attached as a text file. 0 never asks. */
	longPaste: z.number().int().min(0).max(1_000_000).catch(2000),
})

export type UserPreferences = z.infer<typeof userPreferencesSchema>
