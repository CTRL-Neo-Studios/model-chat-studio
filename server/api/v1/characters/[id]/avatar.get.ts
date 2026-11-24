import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { blob } from 'hub:blob'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { findCharacter } from '#server/utils/chat/characters'

/**
 * A Character's avatar, to signed-in members: lanes show it wherever the Character is used, chats shared with them
 * included. The URL carries the file's id (`?v=`), so the image is cached for good.
 */
export default defineEventHandler(async (event) => {
	await useServerAuth().requireUser(event)
	const notFound = () => createError({ status: 404, statusText: 'No avatar' })
	const found = await findCharacter(db, getRouterParam(event, 'id', { decode: true }))
	if (!found?.avatarFileId) throw notFound()
	const [file] = await db.select().from(schema.file).where(eq(schema.file.id, found.avatarFileId))
	const data = file && await blob.get(file.blobPath)
	if (!file || !data) throw notFound()
	return new Response(data, {
		headers: {
			'Content-Type': file.mediaType,
			'Content-Length': String(data.size),
			'Content-Security-Policy': 'sandbox',
			'X-Content-Type-Options': 'nosniff',
			'Cache-Control': 'private, max-age=31536000, immutable',
		},
	})
})
