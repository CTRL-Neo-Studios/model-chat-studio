import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { z } from 'zod'
import { projectAbilities } from '#shared/abilities/projectAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { assertFolderParent, folderNameSchema, listFolders } from '#server/utils/chat/folders'
import { findProject } from '#server/utils/project/projects'

const bodySchema = z.object({
	name: folderNameSchema,
	/** `null` or absent: top level. */
	parentId: z.uuid().nullable().default(null),
	/** A folder in a project's tree; absent: a personal folder. */
	projectId: z.uuid().nullable().default(null),
}).strict()

export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const { name, parentId, projectId } = await readValidatedBody(event, bodySchema)
	if (projectId) await authorize(event, projectAbilities().startChats, await findProject(db, projectId))
	// The parent must be in the same tree.
	assertFolderParent((await listFolders(db, user.id)).filter(folder => folder.projectId === projectId), parentId)
	const [folder] = await db.insert(schema.chatFolder).values({ userId: user.id, name, parentId, projectId })
		.returning({ id: schema.chatFolder.id, parentId: schema.chatFolder.parentId, name: schema.chatFolder.name, projectId: schema.chatFolder.projectId })
	return folder!
})
