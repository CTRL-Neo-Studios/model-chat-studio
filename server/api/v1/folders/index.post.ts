import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { z } from 'zod'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { assertFolderParent, folderNameSchema, listFolders } from '#server/utils/chat/folders'

const bodySchema = z.object({
	name: folderNameSchema,
	/** `null` or absent: top level. */
	parentId: z.uuid().nullable().default(null),
}).strict()

export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const { name, parentId } = await readValidatedBody(event, bodySchema)
	assertFolderParent(await listFolders(db, user.id), parentId)
	const [folder] = await db.insert(schema.chatFolder).values({ userId: user.id, name, parentId })
		.returning({ id: schema.chatFolder.id, parentId: schema.chatFolder.parentId, name: schema.chatFolder.name })
	return folder!
})
