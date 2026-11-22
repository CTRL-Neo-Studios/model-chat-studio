import { defineEventHandler } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { useServerAuth } from '#server/utils/core/useServerAuth'

/** What the member pinned; lists show these first. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	return await db.select({ kind: schema.pin.kind, targetId: schema.pin.targetId }).from(schema.pin)
		.where(eq(schema.pin.userId, user.id))
})
