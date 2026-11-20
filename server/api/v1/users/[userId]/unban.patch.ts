import { defineEventHandler, getRouterParam } from 'nuxt/server'
import {useServerUsers} from "#server/utils/core/useServerUsers";

export default defineEventHandler(async event => {
	const userId = getRouterParam(event, 'userId', { decode: true })!
	const { unbanUserHandler } = useServerUsers()

	return await unbanUserHandler(event, userId)
})
