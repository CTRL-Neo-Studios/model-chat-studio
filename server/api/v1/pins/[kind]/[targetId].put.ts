import { createError, defineEventHandler, getRouterParams } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { count, eq } from 'drizzle-orm'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { pinParamsSchema } from '#server/utils/core/pins'

const MAX_PINS = 200

/**
 * Pins a chat, chat folder, model profile or project to the top of the member's lists. A pin only orders the
 * member's own lists, so the target is not looked up: pinning something one cannot see shows nothing.
 */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const params = pinParamsSchema.safeParse(getRouterParams(event, { decode: true }))
	if (!params.success) throw createError({ status: 404, statusText: 'Nothing to pin here' })
	const [pins] = await db.select({ total: count() }).from(schema.pin).where(eq(schema.pin.userId, user.id))
	if (pins!.total >= MAX_PINS) throw createError({ status: 400, statusText: `At most ${MAX_PINS} pins. Unpin something first.` })

	await db.insert(schema.pin).values({ userId: user.id, ...params.data }).onConflictDoNothing()
	return params.data
})
