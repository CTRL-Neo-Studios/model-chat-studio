import { createHash } from 'node:crypto'
import { blob } from 'hub:blob'
import { schema } from 'hub:db'
import { and, eq, inArray } from 'drizzle-orm'
import type { UIMessage } from 'ai'
import { FILE_UPLOAD, FILE_URL_PATTERN } from '#shared/utils/file'
import type { Db } from '#server/utils/core/settings'
import { type ActiveInference, useInference } from '#server/utils/inference'
import type { CatalogModel } from '#server/utils/inference/types'

/** Provider-side copies are tied to the account of the key that made them; only a hash of it is stored. */
function hashApiKey(apiKey: string) {
	return createHash('sha256').update(apiKey).digest('hex')
}

/**
 * Deletes files: rows first, then each blob (one at a time: the S3 driver's batch delete omits the
 * `Content-MD5` AWS requires), then the platform copies made with the member's current key. Copies made
 * with another key cannot be deleted here; DeepSeek drops them after 30 days.
 */
export async function deleteStoredFiles(db: Db, ids: string[], userId: string) {
	if (!ids.length) return
	const [rows, remote, inference] = await Promise.all([
		db.select({ blobPath: schema.file.blobPath }).from(schema.file).where(inArray(schema.file.id, ids)),
		db.select().from(schema.providerFile).where(inArray(schema.providerFile.fileId, ids)),
		useInference(db, userId),
	])
	await db.delete(schema.file).where(inArray(schema.file.id, ids))

	for (const row of rows) {
		await blob.del(row.blobPath).catch(error => console.error('[files] blob delete failed', row.blobPath, error))
	}
	const pdfUpload = inference?.platform.pdfUpload
	if (!pdfUpload) return
	const keyHash = hashApiKey(inference.apiKey)
	for (const copy of remote.filter(copy => copy.platform === inference.platform.id && copy.keyHash === keyHash)) {
		await pdfUpload.remove(inference.apiKey, copy.remoteId).catch(error => console.error('[files] remote delete failed', copy.remoteId, error))
	}
}

interface AttachmentContext {
	db: Db
	inference: ActiveInference
	model: CatalogModel
	userId: string
	chatId: string
}

/** The platform's id for an uploaded PDF, uploading it the first time (DeepSeek bills parsing per upload). */
async function remotePdfId(context: AttachmentContext, fileId: string, bytes: Uint8Array, name: string) {
	const { db, inference } = context
	const keyHash = hashApiKey(inference.apiKey)
	const [cached] = await db.select().from(schema.providerFile).where(and(
		eq(schema.providerFile.fileId, fileId),
		eq(schema.providerFile.platform, inference.platform.id),
		eq(schema.providerFile.keyHash, keyHash),
	))
	// A day of margin, so a copy does not expire in the middle of a turn.
	if (cached && (!cached.expiresAt || cached.expiresAt.getTime() > Date.now() + 24 * 3600_000)) return cached.remoteId

	const { remoteId, expiresAt } = await inference.platform.pdfUpload!.upload(inference.apiKey, { bytes, name })
	await db.insert(schema.providerFile).values({ fileId, platform: inference.platform.id, keyHash, remoteId, expiresAt })
		.onConflictDoUpdate({ target: [schema.providerFile.fileId, schema.providerFile.platform, schema.providerFile.keyHash], set: { remoteId, expiresAt } })
	// The upload response has no page count, so the parse cost is unknown.
	await db.insert(schema.usageEvent).values({
		userId: context.userId, chatId: context.chatId, kind: 'parse', platform: inference.platform.id, byok: inference.byok, costUsd: null,
	})
	return remoteId
}

const textTypes: readonly string[] = FILE_UPLOAD.textTypes

/**
 * Turns the attachments in a chat's messages into what the model can take: text files become text,
 * images and PDFs are sent inline or (DeepSeek PDFs) by reference, and anything the model cannot
 * read is replaced by a note saying so.
 */
export async function resolveAttachments(context: AttachmentContext, messages: UIMessage[]): Promise<UIMessage[]> {
	const ids = messages.flatMap(message => message.parts.flatMap(part => part.type === 'file' ? [FILE_URL_PATTERN.exec(part.url)?.[1] ?? ''] : []))
	if (!ids.length) return messages
	const rows = await context.db.select().from(schema.file)
		.where(and(inArray(schema.file.id, ids.filter(Boolean)), eq(schema.file.chatId, context.chatId)))
	const byId = Object.fromEntries(rows.map(row => [row.id, row]))
	const accepts = (modality: string) => context.model.inputModalities.includes(modality)

	async function resolve(part: UIMessage['parts'][number]): Promise<UIMessage['parts'][number]> {
		if (part.type !== 'file') return part
		const row = byId[FILE_URL_PATTERN.exec(part.url)?.[1] ?? '']
		const name = row?.fileName ?? part.filename ?? 'file'
		const note = (reason: string) => ({ type: 'text' as const, text: `[Attachment "${name}" left out: ${reason}]` })
		if (!row) return note('it was deleted.')

		const isImage = row.mediaType.startsWith('image/')
		const isPdf = row.mediaType === FILE_UPLOAD.pdfType
		if (isImage && !accepts('image')) return note('this model does not read images.')
		if (isPdf && !accepts('file')) return note('this model does not read PDFs.')

		const stored = await blob.get(row.blobPath)
		if (!stored) return note('its file is missing.')
		if (textTypes.includes(row.mediaType)) {
			return { type: 'text', text: `<file name="${name.replace(/"/g, '\'')}">\n${await stored.text()}\n</file>` }
		}
		const bytes = new Uint8Array(await stored.arrayBuffer())
		if (isPdf && context.inference.platform.pdfUpload) {
			const remoteId = await remotePdfId(context, row.id, bytes, name)
			return { type: 'file', url: part.url, filename: name, ...context.inference.platform.pdfUpload.reference(remoteId) }
		}
		return { type: 'file', mediaType: row.mediaType, filename: name, url: `data:${row.mediaType};base64,${Buffer.from(bytes).toString('base64')}` }
	}

	return await Promise.all(messages.map(async message => message.role === 'user'
		? { ...message, parts: await Promise.all(message.parts.map(resolve)) }
		: message))
}
