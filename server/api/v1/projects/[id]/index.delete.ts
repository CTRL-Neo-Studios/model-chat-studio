import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { projectAbilities } from '#shared/abilities/projectAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { deleteStoredFiles } from '#server/utils/chat/files'
import { findProject, listEntries } from '#server/utils/project/projects'

/** Deletes the project and its file space, uploads included. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const project = await findProject(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, projectAbilities().manageProject, project)
	const fileIds = (await listEntries(db, project!.id)).flatMap(entry => entry.fileId ? [entry.fileId] : [])
	// Uploads first: if that fails, nothing is lost and the delete can be retried.
	await deleteStoredFiles(db, fileIds, user.id)
	await db.delete(schema.project).where(eq(schema.project.id, project!.id))
	return { id: project!.id }
})
