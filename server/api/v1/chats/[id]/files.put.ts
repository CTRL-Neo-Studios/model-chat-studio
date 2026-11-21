import { randomUUID } from 'node:crypto'
import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { blob } from 'hub:blob'
import { db, schema } from 'hub:db'
import { z } from 'zod'
import { chatAbilities } from '#shared/abilities/chatAbilities'
import { FILE_UPLOAD_TYPES } from '#shared/utils/file'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { findChat } from '#server/utils/chat/turns'

const MAX_BYTES = 8 * 1024 * 1024

// Browsers often send no type, or a spreadsheet type for CSV, for these.
const typesByExtension: Record<string, string> = { csv: 'text/csv', md: 'text/markdown', txt: 'text/plain' }

/**
 * Uploads one attachment (form field `file`) for a chat. The home page uploads before the chat
 * exists; once it does, only its owner may add files. The stored name is generated on the server;
 * the original name is kept only in the `file` row.
 */
export default defineEventHandler(async (event) => {
	const chatId = getRouterParam(event, 'id', { decode: true })
	if (!z.uuid().safeParse(chatId).success) throw createError({ status: 404, statusText: 'Chat not found' })
	const [user, chat] = await Promise.all([useServerAuth().requireUser(event), findChat(db, chatId)])
	if (chat) await authorize(event, chatAbilities().manageChat, chat)

	const upload = (await event.req.formData()).get('file')
	if (!(upload instanceof File)) throw createError({ status: 400, statusText: 'Send the file in the `file` field' })
	const extension = /\.([a-z0-9]{1,8})$/i.exec(upload.name)?.[1]?.toLowerCase() ?? ''
	const mediaType = typesByExtension[extension] ?? upload.type
	if (!FILE_UPLOAD_TYPES.includes(mediaType)) throw createError({ status: 400, statusText: 'Images, PDFs and text files (CSV, Markdown, plain text) only' })
	if (upload.size > MAX_BYTES) throw createError({ status: 413, statusText: 'Files can be at most 8 MB' })

	const id = randomUUID()
	const blobPath = `${user.id}/${chatId}/${id}${extension ? `.${extension}` : ''}`
	await blob.put(blobPath, upload, { contentType: mediaType })
	const fileName = upload.name.slice(0, 255) || 'file'
	await db.insert(schema.file).values({ id, ownerId: user.id, chatId, blobPath, fileName, mediaType, size: upload.size })

	return { id, url: `/api/v1/files/${id}`, mediaType, filename: fileName, size: upload.size }
})
