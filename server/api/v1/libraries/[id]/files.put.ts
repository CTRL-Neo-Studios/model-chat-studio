import { randomUUID } from 'node:crypto'
import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { blob } from '#server/utils/core/blob'
import { db, schema } from 'hub:db'
import { z } from 'zod'
import { libraryAbilities } from '#shared/abilities/libraryAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { readUpload } from '#server/utils/chat/files'
import { assertEntryParent, entryColumns, findLibrary, listEntries, withUniqueName } from '#server/utils/library/libraries'
import { entryNameSchema } from '#shared/utils/libraryFields'

/**
 * Uploads one file (form field `file`) into the library, in the folder named by the form field `parentId` (absent:
 * top level). Same types and limit as chat attachments.
 */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const library = await findLibrary(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, libraryAbilities().editFiles, library)

	const { form, upload, mediaType, extension } = await readUpload(event)
	const parent = form.get('parentId')
	const parentId = typeof parent === 'string' && parent ? parent : null
	if (parentId !== null && !z.uuid().safeParse(parentId).success) throw createError({ status: 404, statusText: 'Folder not found' })
	assertEntryParent(await listEntries(db, library!.id), parentId)
	const name = entryNameSchema.safeParse(upload.name)
	if (!name.success) throw createError({ status: 400, statusText: 'This file name cannot be used. Rename the file and try again.' })

	const id = randomUUID()
	const blobPath = `libraries/${library!.id}/${id}${extension ? `.${extension}` : ''}`
	await blob.put(blobPath, upload, { contentType: mediaType })
	try {
		return await withUniqueName(db.transaction(async (tx) => {
			await tx.insert(schema.file).values({ id, ownerId: user.id, blobPath, fileName: name.data, mediaType, size: upload.size })
			const [entry] = await tx.insert(schema.libraryEntry).values({
				libraryId: library!.id, parentId, kind: 'file', name: name.data, fileId: id, createdBy: user.id,
			}).returning(entryColumns)
			return { ...entry!, mediaType, size: upload.size }
		}))
	}
	catch (error) {
		await blob.del(blobPath).catch(cleanup => console.error('[libraries] blob delete failed', blobPath, cleanup))
		throw error
	}
})
