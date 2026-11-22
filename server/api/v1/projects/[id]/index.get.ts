import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db } from 'hub:db'
import { projectAbilities } from '#shared/abilities/projectAbilities'
import { authorize } from '#server/utils/core/authorize'
import { findProject } from '#server/utils/project/projects'

export default defineEventHandler(async (event) => {
	const project = await findProject(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, projectAbilities().readProject, project)
	return project!
})
