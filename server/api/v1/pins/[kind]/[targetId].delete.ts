import { createError, defineEventHandler, getRouterParams } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { and, eq } from 'drizzle-orm'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { pinParamsSchema } from '#server/utils/core/pins'

export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const params = pinParamsSchema.safeParse(getRouterParams(event, { decode: true }))
	if (!params.success) throw createError({ status: 404, statusText: 'Nothing to unpin here' })
	const { kind, targetId } = params.data
	await db.delete(schema.pin).where(and(eq(schema.pin.userId, user.id), eq(schema.pin.kind, kind), eq(schema.pin.targetId, targetId)))
	return params.data
})
