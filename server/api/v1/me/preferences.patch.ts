import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { STOPPED_REGENERATE_OPTIONS, userPreferencesSchema } from '#shared/utils/preferences'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { assertCharacterUsable } from '#server/utils/chat/characters'

const bodySchema = z.object({
	stoppedRegenerate: z.enum(STOPPED_REGENERATE_OPTIONS),
	/** Who the member is in new chats; `null`: nobody in particular. */
	characterId: z.uuid().nullable(),
}).partial().strict()

/** Changes the member's own preferences; absent fields stay as they are. Returns them all. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const changes = await readValidatedBody(event, bodySchema)
	await assertCharacterUsable(db, user.id, changes.characterId)
	const preferences = { ...user.preferences, ...changes }
	await db.update(schema.user).set({ preferences }).where(eq(schema.user.id, user.id))
	return userPreferencesSchema.parse(preferences)
})
