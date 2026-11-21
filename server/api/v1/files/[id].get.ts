import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { blob } from 'hub:blob'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { chatAbilities } from '#shared/abilities/chatAbilities'
import { FILE_UPLOAD } from '#shared/utils/file'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { findChat } from '#server/utils/chat/turns'

const inlineTypes: readonly string[] = [...FILE_UPLOAD.imageTypes, FILE_UPLOAD.pdfType]

/**
 * Serves an attachment to whoever may read its chat; before the chat exists, to its uploader only.
 * Anything other than an image or PDF downloads instead of rendering, and the sandbox policy keeps
 * an uploaded file from running script on the app's origin.
 */
export default defineEventHandler(async (event) => {
	const id = getRouterParam(event, 'id', { decode: true })
	const notFound = () => createError({ status: 404, statusText: 'File not found' })
	if (!z.uuid().safeParse(id).success) throw notFound()
	const [file] = await db.select().from(schema.file).where(eq(schema.file.id, id!))
	if (!file) throw notFound()

	const chat = file.chatId ? await findChat(db, file.chatId) : undefined
	if (chat) await authorize(event, chatAbilities().readChat, chat)
	else if ((await useServerAuth().getUser(event))?.id !== file.ownerId) throw notFound()

	const data = await blob.get(file.blobPath)
	if (!data) throw notFound()
	const disposition = inlineTypes.includes(file.mediaType) ? 'inline' : 'attachment'
	return new Response(data, {
		headers: {
			'Content-Type': file.mediaType,
			'Content-Length': String(data.size),
			'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(file.fileName ?? 'file')}`,
			'Content-Security-Policy': 'sandbox',
			'Cache-Control': 'private, max-age=3600',
		},
	})
})
