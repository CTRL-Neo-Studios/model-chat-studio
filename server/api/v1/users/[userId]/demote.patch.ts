import { defineEventHandler, getRouterParam } from 'nuxt/server'
import {useServerUsers} from "#server/utils/core/useServerUsers";

export default defineEventHandler(async event => {
	const userId = getRouterParam(event, 'userId', { decode: true })!
	const { demoteUserHandler } = useServerUsers()

	return await demoteUserHandler(event, userId)
})
