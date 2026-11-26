import { randomUUID } from 'node:crypto'
import { createError, defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { blob } from '#server/utils/core/blob'
import { db, schema } from 'hub:db'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { libraryAbilities } from '#shared/abilities/libraryAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { assertEntryParent, entryColumns, findLibrary, listEntries, withUniqueName } from '#server/utils/library/libraries'
import { entryNameSchema } from '#shared/utils/libraryFields'

const bodySchema = z.object({
	/** An upload of one of the member's chats that has this library attached. */
	fileId: z.uuid(),
	/** `null` or absent: top level. */
	parentId: z.uuid().nullable().default(null),
}).strict()

/**
 * "Add to library": copies a chat upload into the library. A copy, so the chat's file and the library's can each be
 * deleted on their own.
 */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const library = await findLibrary(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, libraryAbilities().editFiles, library)
	const { fileId, parentId } = await readValidatedBody(event, bodySchema)

	const [source] = await db.select({ file: schema.file }).from(schema.file)
		.innerJoin(schema.chat, eq(schema.chat.id, schema.file.chatId))
		.innerJoin(schema.chatLibrary, and(eq(schema.chatLibrary.chatId, schema.chat.id), eq(schema.chatLibrary.libraryId, library!.id)))
		.where(and(eq(schema.file.id, fileId), eq(schema.chat.userId, user.id)))
	if (!source) throw createError({ status: 404, statusText: 'File not found in the chats this library is attached to' })
	assertEntryParent(await listEntries(db, library!.id), parentId)
	const name = entryNameSchema.safeParse(source.file.fileName ?? 'file')
	if (!name.success) throw createError({ status: 400, statusText: 'This file name cannot be used in a library' })

	const stored = await blob.get(source.file.blobPath)
	if (!stored) throw createError({ status: 404, statusText: 'The file is missing from storage' })
	const id = randomUUID()
	const blobPath = `libraries/${library!.id}/${id}${/\.[a-z0-9]{1,8}$/i.exec(source.file.blobPath)?.[0] ?? ''}`
	await blob.put(blobPath, stored, { contentType: source.file.mediaType })
	try {
		return await withUniqueName(db.transaction(async (tx) => {
			await tx.insert(schema.file).values({ id, ownerId: user.id, blobPath, fileName: name.data, mediaType: source.file.mediaType, size: source.file.size })
			const [entry] = await tx.insert(schema.libraryEntry).values({
				libraryId: library!.id, parentId, kind: 'file', name: name.data, fileId: id, createdBy: user.id,
			}).returning(entryColumns)
			return { ...entry!, mediaType: source.file.mediaType, size: source.file.size }
		}))
	}
	catch (error) {
		await blob.del(blobPath).catch(cleanup => console.error('[libraries] blob delete failed', blobPath, cleanup))
		throw error
	}
})
