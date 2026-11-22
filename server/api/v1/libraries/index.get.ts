import { defineEventHandler } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { desc, eq, getTableColumns, or, sql } from 'drizzle-orm'
import { libraryAbilities } from '#shared/abilities/libraryAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'

/** The member's libraries and the ones shared with them, most recently changed first, each with the member's `role`. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	await authorize(event, libraryAbilities().useLibraries)
	return await db.select({
		...getTableColumns(schema.library),
		role: sql<'owner' | 'viewer' | 'editor'>`coalesce(${schema.libraryMember.role}, 'owner')`,
	}).from(schema.library)
		.leftJoin(schema.libraryMember, sql`${schema.libraryMember.libraryId} = ${schema.library.id} and ${schema.libraryMember.userId} = ${user.id}`)
		.where(or(eq(schema.library.ownerId, user.id), eq(schema.libraryMember.userId, user.id)))
		.orderBy(desc(schema.library.updatedAt))
})
