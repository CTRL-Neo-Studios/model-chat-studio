import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { db } from 'hub:db'
import { exploreAbilities } from '#shared/abilities/exploreAbilities'
import { exploreSettingsSchema } from '#shared/utils/package'
import { authorize } from '#server/utils/core/authorize'
import { getSetting, setSetting } from '#server/utils/core/settings'

const bodySchema = exploreSettingsSchema.partial().strict()

/** Admins and moderators: publishing on or off, the categories, the size limit. Absent fields stay as they are. */
export default defineEventHandler(async (event) => {
	await authorize(event, exploreAbilities().moderateExplore)
	const patch = await readValidatedBody(event, bodySchema)
	const next = { ...await getSetting(db, 'explore'), ...patch }
	await setSetting(db, 'explore', next)
	return next
})
