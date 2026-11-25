import { defineEventHandler } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { and, desc, eq } from 'drizzle-orm'
import { chatAbilities } from '#shared/abilities/chatAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'

/**
 * The chats other people shared with the member by name, most recently active first, each with its owner and the
 * member's role in it (`viewer` or `editor`). Chats the member only opened through a public link are not here: link
 * access names nobody.
 */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	await authorize(event, chatAbilities().useChats)
	return await db.select({
		id: schema.chat.id,
		title: schema.chat.title,
		updatedAt: schema.chat.updatedAt,
		sharedAt: schema.chatShare.createdAt,
		role: schema.chatShare.role,
		owner: { id: schema.user.id, username: schema.user.username, name: schema.user.name, avatarUrl: schema.user.avatarUrl },
	}).from(schema.chatShare)
		.innerJoin(schema.chat, eq(schema.chat.id, schema.chatShare.chatId))
		.innerJoin(schema.user, eq(schema.user.id, schema.chat.userId))
		.where(and(eq(schema.chatShare.userId, user.id), eq(schema.chat.temporary, false)))
		.orderBy(desc(schema.chat.updatedAt))
})
