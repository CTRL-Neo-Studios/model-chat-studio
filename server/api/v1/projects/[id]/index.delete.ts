import { defineEventHandler, getRouterParam, getValidatedQuery } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { projectAbilities } from '#shared/abilities/projectAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { deleteStoredFiles } from '#server/utils/chat/files'
import { detachProjectChats, findProject, listEntries } from '#server/utils/project/projects'

const querySchema = z.object({
	/** The owner's own chats in the project: deleted with it, or kept as ordinary chats (the default). */
	ownChats: z.enum(['delete', 'keep']).default('keep'),
})

/**
 * Deletes the project and its file space, uploads included. The owner's own chats in it are deleted or kept, as
 * asked; everyone else's are always kept, as ordinary chats.
 */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const project = await findProject(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, projectAbilities().manageProject, project)
	const { ownChats } = await getValidatedQuery(event, querySchema.parse)

	const own = ownChats === 'delete'
		? (await db.select({ id: schema.chat.id }).from(schema.chat).where(and(eq(schema.chat.projectId, project!.id), eq(schema.chat.userId, user.id)))).map(chat => chat.id)
		: []
	const chatFiles = own.length ? await db.select({ id: schema.file.id }).from(schema.file).where(inArray(schema.file.chatId, own)) : []
	const fileIds = (await listEntries(db, project!.id)).flatMap(entry => entry.fileId ? [entry.fileId] : [])
	// Uploads first: if that fails, nothing is lost and the delete can be retried.
	await deleteStoredFiles(db, [...fileIds, ...chatFiles.map(file => file.id)], user.id)
	if (own.length) await db.delete(schema.chat).where(inArray(schema.chat.id, own))
	await detachProjectChats(db, project!.id)
	await db.delete(schema.project).where(eq(schema.project.id, project!.id))
	return { id: project!.id, deletedChats: own.length }
})
