import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { STOPPED_REGENERATE_OPTIONS, userPreferencesSchema } from '#shared/utils/preferences'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { assertCharacterUsable } from '#server/utils/chat/characters'

const voice = z.string().trim().min(1).max(100).nullable()

const bodySchema = z.object({
	stoppedRegenerate: z.enum(STOPPED_REGENERATE_OPTIONS),
	/** Who the member is in new chats; `null`: nobody in particular. */
	characterId: z.uuid().nullable(),
	/** The read-aloud voice per platform; `null` goes back to the platform's default. Other platforms' stay. */
	voices: z.object({ openrouter: voice, deepseek: voice }).partial().strict(),
	/** Characters past which a paste asks how it goes in; 0 never asks. */
	longPaste: userPreferencesSchema.shape.longPaste.unwrap(),
}).partial().strict()

/** Changes the member's own preferences; absent fields stay as they are. Returns them all. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const { voices, ...changes } = await readValidatedBody(event, bodySchema)
	await assertCharacterUsable(db, user.id, changes.characterId)
	const current = userPreferencesSchema.parse(user.preferences ?? {})
	const merged = voices && Object.fromEntries(Object.entries({ ...current.voices, ...voices }).filter(([, value]) => value))
	const preferences = { ...user.preferences, ...changes, ...(merged && { voices: merged }) }
	await db.update(schema.user).set({ preferences }).where(eq(schema.user.id, user.id))
	return userPreferencesSchema.parse(preferences)
})
