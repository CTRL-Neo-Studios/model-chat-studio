import { defineEventHandler } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { and, desc, eq, inArray, lt } from 'drizzle-orm'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { deleteStoredFiles } from '#server/utils/chat/files'

const SWEEP_AFTER_MS = 24 * 3600_000

/**
 * The member's own chats, newest first, without temporary ones. Their temporary chats older than a day (a tab
 * that closed without deleting its chat) are deleted here, with their files.
 */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const [chats, stale] = await Promise.all([
		db.select({
			id: schema.chat.id,
			title: schema.chat.title,
			visibility: schema.chat.visibility,
			folderId: schema.chat.folderId,
			createdAt: schema.chat.createdAt,
			updatedAt: schema.chat.updatedAt,
		}).from(schema.chat)
			.where(and(eq(schema.chat.userId, user.id), eq(schema.chat.temporary, false)))
			.orderBy(desc(schema.chat.createdAt)),
		db.select({ id: schema.chat.id }).from(schema.chat).where(and(
			eq(schema.chat.userId, user.id),
			eq(schema.chat.temporary, true),
			lt(schema.chat.createdAt, new Date(Date.now() - SWEEP_AFTER_MS)),
		)),
	])
	if (stale.length) {
		const ids = stale.map(chat => chat.id)
		const files = await db.select({ id: schema.file.id }).from(schema.file).where(inArray(schema.file.chatId, ids))
		await deleteStoredFiles(db, files.map(file => file.id), user.id)
		await db.delete(schema.chat).where(inArray(schema.chat.id, ids))
	}
	return chats
})
