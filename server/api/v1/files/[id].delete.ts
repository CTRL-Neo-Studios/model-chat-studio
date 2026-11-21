import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { deleteStoredFiles } from '#server/utils/chat/files'
import { useInference } from '#server/utils/inference'

/**
 * Removes an attachment from the prompt before it is sent. A sent attachment belongs to its message
 * and goes with it (edit, regenerate, chat delete).
 */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const id = getRouterParam(event, 'id', { decode: true })
	if (!z.uuid().safeParse(id).success) throw createError({ status: 404, statusText: 'File not found' })
	const [file] = await db.select({ id: schema.file.id }).from(schema.file)
		.where(and(eq(schema.file.id, id!), eq(schema.file.ownerId, user.id), isNull(schema.file.messageId)))
	if (!file) throw createError({ status: 404, statusText: 'File not found' })

	await deleteStoredFiles(db, [file.id], await useInference(db, user.id))
	return { id: file.id }
})
