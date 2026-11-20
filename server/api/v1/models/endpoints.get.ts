import { createError, defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { db } from 'hub:db'
import { z } from 'zod'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { getCatalog, getEndpoints, useInference } from '#server/utils/inference'

/** Upstream providers for one model (OpenRouter). Model ids contain slashes, hence a query parameter. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const { id } = await getValidatedQuery(event, z.object({ id: z.string().min(1) }))
	const inference = await useInference(db, user.id)
	if (!inference) throw createError({ status: 503, statusText: 'No inference platform is configured' })

	// Only models the user may pick; this also keeps arbitrary paths out of the upstream URL.
	if (!(await getCatalog(db, inference)).some(model => model.id === id)) {
		throw createError({ status: 404, statusText: 'Model not found' })
	}
	return await getEndpoints(inference, id)
})
