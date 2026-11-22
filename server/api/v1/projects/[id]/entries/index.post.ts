import { defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { z } from 'zod'
import { projectAbilities } from '#shared/abilities/projectAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { assertEntryParent, entryNameSchema, findProject, listEntries, noteContentSchema, tagsSchema, withUniqueName } from '#server/utils/project/projects'

const bodySchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('folder') }),
	z.object({ kind: z.literal('note'), content: noteContentSchema.default('') }),
]).and(z.object({
	name: entryNameSchema,
	/** `null` or absent: top level. */
	parentId: z.uuid().nullable().default(null),
	tags: tagsSchema.default([]),
}))

/** Creates a folder or a note. Files arrive through `PUT /projects/:id/files`. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const project = await findProject(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, projectAbilities().editFiles, project)
	const body = await readValidatedBody(event, bodySchema)
	assertEntryParent(await listEntries(db, project!.id), body.parentId)

	const [entry] = await withUniqueName(db.insert(schema.projectEntry).values({
		projectId: project!.id,
		parentId: body.parentId,
		kind: body.kind,
		name: body.name,
		tags: body.tags,
		content: body.kind === 'note' ? body.content : null,
		createdBy: user.id,
	}).returning())
	return entry!
})
