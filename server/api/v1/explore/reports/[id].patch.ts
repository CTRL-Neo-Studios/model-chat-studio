import { createError, defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { db } from 'hub:db'
import { z } from 'zod'
import { exploreAbilities } from '#shared/abilities/exploreAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { findReport, resolveReport } from '#server/utils/explore/reports'

const bodySchema = z.union([
	z.object({ dismiss: z.literal(true) }).strict(),
	z.object({ remove: z.literal(true), reason: z.string().trim().min(1).max(500) }).strict(),
])

/** Admins and moderators: dismiss an open report, or remove its listing with the reason its publisher sees. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	await authorize(event, exploreAbilities().moderateExplore)
	const report = await findReport(db, getRouterParam(event, 'id', { decode: true }))
	if (!report) throw createError({ status: 404, statusText: 'Report not found' })
	await resolveReport(db, { reportId: report.id, resolverId: user.id, decision: await readValidatedBody(event, bodySchema) })
	return { id: report.id }
})
