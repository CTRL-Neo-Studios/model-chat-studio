import { defineEventHandler, getRequestURL, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { z } from 'zod'
import { adminAbilities } from '#shared/abilities/adminAbilities'
import { authorize } from '#server/utils/core/authorize'
import { hashInviteCode, newInviteCode } from '#server/utils/core/signup'

const bodySchema = z.object({
	maxUses: z.number().int().min(1).max(1000).default(1),
	/** `null` never expires. */
	expiresInDays: z.number().int().min(1).max(365).nullable().default(7),
})

/** Creates an invite. The link is returned once and cannot be shown again. */
export default defineEventHandler(async (event) => {
	await authorize(event, adminAbilities().manageInvites)
	const { maxUses, expiresInDays } = await readValidatedBody(event, bodySchema)
	const { user } = await requireUserSession(event)

	const code = newInviteCode()
	const [created] = await db.insert(schema.invite).values({
		codeHash: hashInviteCode(code),
		createdBy: user.id,
		maxUses,
		expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null,
	}).returning({ id: schema.invite.id, maxUses: schema.invite.maxUses, expiresAt: schema.invite.expiresAt })

	return { ...created!, url: `${getRequestURL(event).origin}/invite/${code}` }
})
