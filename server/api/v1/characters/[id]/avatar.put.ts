import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { db } from 'hub:db'
import { profileAbilities } from '#shared/abilities/profileAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { findCharacter } from '#server/utils/chat/characters'
import { avatarType, MAX_AVATAR_BYTES, storeAvatar } from '#server/utils/chat/avatars'

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
	await storeAvatar(db, { characterId: found!.id, previousFileId: found!.avatarFileId, userId: user.id, data: upload, fileName: upload.name, type })
	return (await findCharacter(db, found!.id))!
})
