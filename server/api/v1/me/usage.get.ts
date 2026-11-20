import { defineEventHandler } from 'nuxt/server'
import { db } from 'hub:db'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { monthlyBudgetStatus } from '#server/utils/chat/turns'

/** This month's spend on the instance key against the member's budget (`budgetUsd: null` is unlimited). */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	return await monthlyBudgetStatus(db, user)
})
