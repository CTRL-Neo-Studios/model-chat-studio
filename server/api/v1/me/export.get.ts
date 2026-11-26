import { defineEventHandler } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { and, asc, eq } from 'drizzle-orm'
import { assertRateLimit } from '#server/utils/core/rateLimit'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { exportChat } from '#server/utils/chat/export'

/**
 * Every chat the member owns as one download (milestone 12 plan, section 3): a chat file per line (JSON Lines),
 * without attachments, oldest first. Temporary chats are left out. Written a chat at a time, so a long history is
 * never held whole.
 */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	assertRateLimit(`export-all:${user.id}`, 3, 60_000, 'exports of all chats')
	const chats = await db.select({ id: schema.chat.id }).from(schema.chat)
		.where(and(eq(schema.chat.userId, user.id), eq(schema.chat.temporary, false)))
		.orderBy(asc(schema.chat.createdAt))

	const encoder = new TextEncoder()
	let next = 0
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			const chat = chats[next++]
			if (!chat) return controller.close()
			// A chat deleted while the download runs is skipped.
			const file = await exportChat(db, chat.id).catch(() => null)
			controller.enqueue(encoder.encode(file ? `${JSON.stringify(file)}\n` : ''))
		},
	})
	const name = `chats-${new Date().toISOString().slice(0, 10)}.jsonl`
	return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` } })
})
