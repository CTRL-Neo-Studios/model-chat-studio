import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db } from 'hub:db'
import { projectAbilities } from '#shared/abilities/projectAbilities'
import { authorize } from '#server/utils/core/authorize'
import { findProject, listEntries } from '#server/utils/project/projects'

/** The project's file space as a flat list; the client builds the tree from `parentId`. */
export default defineEventHandler(async (event) => {
	const project = await findProject(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, projectAbilities().readProject, project)
	return await listEntries(db, project!.id)
})
