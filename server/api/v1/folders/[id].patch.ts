import { createError, defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { assertFolderParent, folderNameSchema, listFolders } from '#server/utils/chat/folders'

const bodySchema = z.object({
	name: folderNameSchema,
	/** `null` moves the folder to the top level. */
	parentId: z.uuid().nullable(),
}).partial().strict()
	.refine(fields => Object.keys(fields).length > 0, 'Nothing to change')

/** Renames or moves one of the member's folders; a move into the folder itself or a folder inside it is refused. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const id = getRouterParam(event, 'id', { decode: true })
	const fields = await readValidatedBody(event, bodySchema)
	const folders = await listFolders(db, user.id)
	const folder = folders.find(entry => entry.id === id)
	if (!folder) throw createError({ status: 404, statusText: 'Folder not found' })
	if (fields.parentId !== undefined) assertFolderParent(folders, fields.parentId, id)

	const [updated] = await db.update(schema.chatFolder).set(fields).where(eq(schema.chatFolder.id, id!))
		.returning({ id: schema.chatFolder.id, parentId: schema.chatFolder.parentId, name: schema.chatFolder.name })
	return updated!
})
