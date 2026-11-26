import { defineEventHandler } from 'nuxt/server'
import { db } from 'hub:db'
import { satisfies } from '#shared/utils/roles'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { exploreCounts } from '#server/utils/explore/reports'

/** The counts beside "Explore": the member's listings rejected or removed, and for reviewers what waits for them. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	return await exploreCounts(db, { id: user.id, staff: satisfies(user, { minRole: 'moderator' }) })
})
