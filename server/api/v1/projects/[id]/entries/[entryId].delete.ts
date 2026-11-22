import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { projectAbilities } from '#shared/abilities/projectAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { deleteStoredFiles } from '#server/utils/chat/files'
import { entrySubtree, findProject, listEntries } from '#server/utils/project/projects'

/** Deletes an entry; a folder goes with everything in it, uploads included. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const project = await findProject(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, projectAbilities().editFiles, project)
	const entries = await listEntries(db, project!.id)
	const id = getRouterParam(event, 'entryId', { decode: true })
	if (!entries.some(entry => entry.id === id)) throw createError({ status: 404, statusText: 'Entry not found' })

	const deleted = entrySubtree(entries, id!)
	// Uploads first (their entries go with their rows): if that fails, nothing is lost and the delete can be retried.
	await deleteStoredFiles(db, deleted.flatMap(entry => entry.fileId ? [entry.fileId] : []), user.id)
	await db.delete(schema.projectEntry).where(eq(schema.projectEntry.id, id!))
	return { ids: deleted.map(entry => entry.id) }
})
