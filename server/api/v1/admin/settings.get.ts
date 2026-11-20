import { defineEventHandler } from 'nuxt/server'
import { db } from 'hub:db'
import { adminAbilities } from '#shared/abilities/adminAbilities'
import { authorize } from '#server/utils/core/authorize'
import { adminSettingsView } from '#server/utils/core/settings'

export default defineEventHandler(async (event) => {
	await authorize(event, adminAbilities().manageSettings)
	return await adminSettingsView(db)
})
