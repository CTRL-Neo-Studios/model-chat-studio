import { defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { z } from 'zod';
import {useServerUsers} from "#server/utils/core/useServerUsers";

const bodySchema = z.object({
	banReason: z.string().optional(),
	banExpires: z.coerce.date().optional()
})

export default defineEventHandler(async event => {
	const userId = getRouterParam(event, 'userId', { decode: true })!
	const { banReason, banExpires } = await readValidatedBody(event, bodySchema)
	const { banUserHandler } = useServerUsers()

	return await banUserHandler(event, userId, banReason, banExpires)
})
