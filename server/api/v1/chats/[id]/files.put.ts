import { randomUUID } from 'node:crypto'
import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { blob } from 'hub:blob'
import { db, schema } from 'hub:db'
import { z } from 'zod'
import { chatAbilities } from '#shared/abilities/chatAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { readUpload } from '#server/utils/chat/files'
import { findChat } from '#server/utils/chat/turns'

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

	const { upload, mediaType, extension } = await readUpload(event)
	const id = randomUUID()
	const blobPath = `${user.id}/${chatId}/${id}${extension ? `.${extension}` : ''}`
	await blob.put(blobPath, upload, { contentType: mediaType })
	const fileName = upload.name.slice(0, 255) || 'file'
	await db.insert(schema.file).values({ id, ownerId: user.id, chatId, blobPath, fileName, mediaType, size: upload.size })

	return { id, url: `/api/v1/files/${id}`, mediaType, filename: fileName, size: upload.size }
})
