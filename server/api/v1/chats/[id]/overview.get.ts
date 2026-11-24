import { defineEventHandler } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { asc, count, eq, sum } from 'drizzle-orm'
import { requireChat } from '#server/utils/chat/access'

/**
 * Owner only: what the conversation overview shows that the chat itself does not carry. Each answer's context blocks
 * in the order sent, every file of the chat, and the spend ledger's totals for the chat by kind (chat, title,
 * compact, parse), which the answers' own token counts are checked against.
 */
export default defineEventHandler(async (event) => {
	const chat = await requireChat(event, 'manageChat')
	const [traces, files, usage] = await Promise.all([
		db.select({ messageId: schema.turnTrace.messageId, blocks: schema.turnTrace.blocks, createdAt: schema.turnTrace.createdAt })
			.from(schema.turnTrace)
			.innerJoin(schema.message, eq(schema.message.id, schema.turnTrace.messageId))
			.where(eq(schema.message.chatId, chat.id))
			.orderBy(asc(schema.message.seq)),
		db.select({
			id: schema.file.id,
			fileName: schema.file.fileName,
			mediaType: schema.file.mediaType,
			size: schema.file.size,
			messageId: schema.file.messageId,
			createdAt: schema.file.createdAt,
		}).from(schema.file).where(eq(schema.file.chatId, chat.id)).orderBy(asc(schema.file.createdAt)),
		db.select({
			kind: schema.usageEvent.kind,
			calls: count(),
			inputTokens: sum(schema.usageEvent.inputTokens).mapWith(Number),
			cachedInputTokens: sum(schema.usageEvent.cachedInputTokens).mapWith(Number),
			outputTokens: sum(schema.usageEvent.outputTokens).mapWith(Number),
			reasoningTokens: sum(schema.usageEvent.reasoningTokens).mapWith(Number),
			costUsd: sum(schema.usageEvent.costUsd).mapWith(Number),
		}).from(schema.usageEvent).where(eq(schema.usageEvent.chatId, chat.id)).groupBy(schema.usageEvent.kind),
	])
	return { traces, files: files.map(file => ({ ...file, url: `/api/v1/files/${file.id}` })), usage }
})
