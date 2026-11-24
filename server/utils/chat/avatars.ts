import { randomUUID } from 'node:crypto'
import { blob } from 'hub:blob'
import { schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import type { Db } from '#server/utils/core/settings'
import { deleteStoredFiles } from '#server/utils/chat/files'

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024

/** The image types an avatar may be, by their first bytes: the type a browser sends is not trusted. */
export function avatarType(head: Uint8Array) {
	const starts = (...bytes: number[]) => bytes.every((byte, index) => head[index] === byte)
	if (starts(0x89, 0x50, 0x4E, 0x47)) return { mediaType: 'image/png', extension: 'png' }
	if (starts(0xFF, 0xD8, 0xFF)) return { mediaType: 'image/jpeg', extension: 'jpg' }
	if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...head.subarray(8, 12)) === 'WEBP') return { mediaType: 'image/webp', extension: 'webp' }
	return undefined
}

/**
 * Stores an image (of a type `avatarType` accepts) as a Character's avatar: a `file` row without a chat, owned by
 * `userId`. The Character's earlier avatar, if any, is deleted.
 */
export async function storeAvatar(db: Db, input: { characterId: string, previousFileId: string | null, userId: string, data: Blob, fileName: string, type: { mediaType: string, extension: string } }) {
	const id = randomUUID()
	const blobPath = `avatars/${input.characterId}/${id}.${input.type.extension}`
	await blob.put(blobPath, input.data, { contentType: input.type.mediaType })
	await db.insert(schema.file).values({ id, ownerId: input.userId, chatId: null, blobPath, fileName: input.fileName.slice(0, 255) || 'avatar', mediaType: input.type.mediaType, size: input.data.size })
	await db.update(schema.character).set({ avatarFileId: id, updatedAt: new Date() }).where(eq(schema.character.id, input.characterId))
	if (input.previousFileId) await deleteStoredFiles(db, [input.previousFileId], input.userId)
}
