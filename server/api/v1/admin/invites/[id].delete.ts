import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { adminAbilities } from '#shared/abilities/adminAbilities'
import { authorize } from '#server/utils/core/authorize'

/** Revokes an invite. Accounts already created with it are kept. */
export default defineEventHandler(async (event) => {
	await authorize(event, adminAbilities().manageInvites)
	const id = z.uuid().safeParse(getRouterParam(event, 'id', { decode: true }))
	if (!id.success) throw createError({ status: 404, statusText: 'Invite not found' })

	const [revoked] = await db.update(schema.invite)
		.set({ revokedAt: new Date() })
		.where(and(eq(schema.invite.id, id.data), isNull(schema.invite.revokedAt)))
		.returning({ id: schema.invite.id })
	if (!revoked) throw createError({ status: 404, statusText: 'Invite not found' })

	return revoked
})
