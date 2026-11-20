import { defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { z } from 'zod';
import {useServerUsers} from "#server/utils/core/useServerUsers";

// Allowlist: profile fields come from GitHub at login and are not editable here.
const bodySchema = z.object({
	role: z.enum(['user', 'moderator', 'admin']).optional(),
	monthlyBudgetUsd: z.number().nonnegative().nullable().optional(),
}).strict()

export default defineEventHandler(async event => {
	const userId = getRouterParam(event, 'userId', { decode: true })!
	const body = await readValidatedBody(event, bodySchema)
	const { editUserHandler } = useServerUsers()

	return await editUserHandler(event, userId, body)
})
