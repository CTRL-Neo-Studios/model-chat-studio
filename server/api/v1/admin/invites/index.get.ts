import { defineEventHandler } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { desc, getTableColumns } from 'drizzle-orm'
import { adminAbilities } from '#shared/abilities/adminAbilities'
import { authorize } from '#server/utils/core/authorize'

export default defineEventHandler(async (event) => {
	await authorize(event, adminAbilities().manageInvites)

	const { codeHash: _, ...columns } = getTableColumns(schema.invite)
	return await db.select(columns).from(schema.invite).orderBy(desc(schema.invite.createdAt))
})
