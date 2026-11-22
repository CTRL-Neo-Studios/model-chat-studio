import { randomUUID } from 'node:crypto'
import { createError, defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { blob } from 'hub:blob'
import { db, schema } from 'hub:db'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { projectAbilities } from '#shared/abilities/projectAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { assertEntryParent, entryColumns, entryNameSchema, findProject, listEntries, withUniqueName } from '#server/utils/project/projects'

const bodySchema = z.object({
	/** An upload of one of the member's chats in this project. */
	fileId: z.uuid(),
	/** `null` or absent: top level. */
	parentId: z.uuid().nullable().default(null),
}).strict()

/**
 * "Add to project": copies a chat upload into the project's file space. A copy, so the chat's file and the project's
 * can each be deleted on their own.
 */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const project = await findProject(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, projectAbilities().editFiles, project)
	const { fileId, parentId } = await readValidatedBody(event, bodySchema)

	const [source] = await db.select({ file: schema.file }).from(schema.file)
		.innerJoin(schema.chat, eq(schema.chat.id, schema.file.chatId))
		.where(and(eq(schema.file.id, fileId), eq(schema.chat.userId, user.id), eq(schema.chat.projectId, project!.id)))
	if (!source) throw createError({ status: 404, statusText: 'File not found in this project\'s chats' })
	assertEntryParent(await listEntries(db, project!.id), parentId)
	const name = entryNameSchema.safeParse(source.file.fileName ?? 'file')
	if (!name.success) throw createError({ status: 400, statusText: 'This file name cannot be used in a project' })

	const stored = await blob.get(source.file.blobPath)
	if (!stored) throw createError({ status: 404, statusText: 'The file is missing from storage' })
	const id = randomUUID()
	const blobPath = `projects/${project!.id}/${id}${/\.[a-z0-9]{1,8}$/i.exec(source.file.blobPath)?.[0] ?? ''}`
	await blob.put(blobPath, stored, { contentType: source.file.mediaType })
	try {
		return await withUniqueName(db.transaction(async (tx) => {
			await tx.insert(schema.file).values({ id, ownerId: user.id, blobPath, fileName: name.data, mediaType: source.file.mediaType, size: source.file.size })
			const [entry] = await tx.insert(schema.projectEntry).values({
				projectId: project!.id, parentId, kind: 'file', name: name.data, fileId: id, createdBy: user.id,
			}).returning(entryColumns)
			return { ...entry!, mediaType: source.file.mediaType, size: source.file.size }
		}))
	}
	catch (error) {
		await blob.del(blobPath).catch(cleanup => console.error('[projects] blob delete failed', blobPath, cleanup))
		throw error
	}
})
