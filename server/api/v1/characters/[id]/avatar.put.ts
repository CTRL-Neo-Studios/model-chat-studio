import { randomUUID } from 'node:crypto'
import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { blob } from 'hub:blob'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { profileAbilities } from '#shared/abilities/profileAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { findCharacter } from '#server/utils/chat/characters'
import { deleteStoredFiles } from '#server/utils/chat/files'

const MAX_AVATAR_BYTES = 2 * 1024 * 1024

/** The image types an avatar may be, by their first bytes: the type the browser sends is not trusted. */
function avatarType(head: Uint8Array) {
	const starts = (...bytes: number[]) => bytes.every((byte, index) => head[index] === byte)
	if (starts(0x89, 0x50, 0x4E, 0x47)) return { mediaType: 'image/png', extension: 'png' }
	if (starts(0xFF, 0xD8, 0xFF)) return { mediaType: 'image/jpeg', extension: 'jpg' }
	if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...head.subarray(8, 12)) === 'WEBP') return { mediaType: 'image/webp', extension: 'webp' }
	return undefined
}

/** Sets a Character's avatar (form field `file`: PNG, JPEG or WebP, at most 2 MB); the earlier one is deleted. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const found = await findCharacter(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, profileAbilities().manageProfile, found)
	const upload = (await event.req.formData()).get('file')
	if (!(upload instanceof File)) throw createError({ status: 400, statusText: 'Send the image in the `file` field' })
	if (upload.size > MAX_AVATAR_BYTES) throw createError({ status: 413, statusText: 'An avatar can be at most 2 MB' })
	const type = avatarType(new Uint8Array(await upload.slice(0, 12).arrayBuffer()))
	if (!type) throw createError({ status: 400, statusText: 'An avatar is a PNG, JPEG or WebP image' })

	const id = randomUUID()
	const blobPath = `avatars/${found!.id}/${id}.${type.extension}`
	await blob.put(blobPath, upload, { contentType: type.mediaType })
	await db.insert(schema.file).values({ id, ownerId: user.id, chatId: null, blobPath, fileName: upload.name.slice(0, 255) || 'avatar', mediaType: type.mediaType, size: upload.size })
	await db.update(schema.character).set({ avatarFileId: id, updatedAt: new Date() }).where(eq(schema.character.id, found!.id))
	if (found!.avatarFileId) await deleteStoredFiles(db, [found!.avatarFileId], user.id)
	return (await findCharacter(db, found!.id))!
})
