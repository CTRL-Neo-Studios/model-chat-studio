import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { db } from 'hub:db'
import { projectAbilities } from '#shared/abilities/projectAbilities'
import { authorize } from '#server/utils/core/authorize'
import { findEntry, findProject } from '#server/utils/project/projects'

/** One entry with a note's text, which the list leaves out. */
export default defineEventHandler(async (event) => {
	const project = await findProject(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, projectAbilities().readProject, project)
	const entry = await findEntry(db, project!.id, getRouterParam(event, 'entryId', { decode: true }))
	if (!entry) throw createError({ status: 404, statusText: 'Entry not found' })
	return entry
})
