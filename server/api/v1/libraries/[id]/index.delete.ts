import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { libraryAbilities } from '#shared/abilities/libraryAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { deleteStoredFiles } from '#server/utils/chat/files'
import { findLibrary, listEntries } from '#server/utils/library/libraries'

/** Deletes the library and its files, uploads included. It comes off every chat it was attached to; the chats stay. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const library = await findLibrary(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, libraryAbilities().manageLibrary, library)
	const fileIds = (await listEntries(db, library!.id)).flatMap(entry => entry.fileId ? [entry.fileId] : [])
	// Uploads first: if that fails, nothing is lost and the delete can be retried.
	await deleteStoredFiles(db, fileIds, user.id)
	await db.delete(schema.library).where(eq(schema.library.id, library!.id))
	return { id: library!.id }
})
