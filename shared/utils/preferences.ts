import { z } from 'zod'

export const STOPPED_REGENERATE_OPTIONS = ['keep-previous', 'keep-partial'] as const

/** A member's own preferences, stored in `user.preferences`. Unset or invalid values read as the default. */
export const userPreferencesSchema = z.object({
	/** What a regenerated answer stopped partway leaves: the answer it was replacing, or what had streamed. */
	stoppedRegenerate: z.enum(STOPPED_REGENERATE_OPTIONS).catch('keep-previous'),
})

export type UserPreferences = z.infer<typeof userPreferencesSchema>
