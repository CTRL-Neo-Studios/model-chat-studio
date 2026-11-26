import { createError, defineEventHandler } from 'nuxt/server'
import { db } from 'hub:db'
import { z } from 'zod'
import { chatAbilities } from '#shared/abilities/chatAbilities'
import { CHAT_FILE_LIMITS } from '#shared/utils/chatFile'
import { authorize } from '#server/utils/core/authorize'
import { assertRateLimit } from '#server/utils/core/rateLimit'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { blob } from '#server/utils/core/blob'
import { getCatalog, useInference } from '#server/utils/inference'
import { importChat, readChatFile } from '#server/utils/chat/import'

/**
 * Import (milestone 12 plan, section 3): a chat file or an OpenRouter Chatroom export in the form field `file`, and an
 * optional `folderId`, one of the member's folders. Always a new chat of the member's. Returns its id and a note of
 * what was changed or left out.
 */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	await authorize(event, chatAbilities().useChats)
	assertRateLimit(`import:${user.id}`, 10, 60_000, 'imports')
	const form = await event.req.formData()
	const upload = form.get('file')
	if (!(upload instanceof File)) throw createError({ status: 400, statusText: 'Send the file in the `file` field' })
	if (upload.size > CHAT_FILE_LIMITS.bytes) throw createError({ status: 413, statusText: 'A chat file can be at most 25 MB' })
	const folderField = form.get('folderId')
	const folderId = typeof folderField === 'string' && folderField ? folderField : null
	if (folderId && !z.uuid().safeParse(folderId).success) throw createError({ status: 404, statusText: 'Folder not found' })

	// A chat file, or an OpenRouter Chatroom export made into one; `left` is what its reader left out.
	const { file, notes: left } = readChatFile(await upload.text())
	// A lane keeps its model when this member may pick it on the active platform.
	const inference = await useInference(db, user.id)
	const models = inference ? await getCatalog(db, inference) : []
	const offered = { platform: inference?.platform.id ?? null, models: Object.fromEntries(models.map(model => [model.id, true as const])) }

	const { chatId, notes } = await importChat(db, {
		userId: user.id,
		file,
		folderId,
		offered,
		writeFile: async (path, bytes, mediaType) => {
			await blob.put(path, bytes, { contentType: mediaType })
		},
		removeFile: path => blob.del(path).catch(error => console.error('[import] blob delete failed', path, error)),
	})
	return { id: chatId, notes: [...left, ...notes] }
})
