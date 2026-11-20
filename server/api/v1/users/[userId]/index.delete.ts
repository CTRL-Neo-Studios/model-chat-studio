import { defineEventHandler, getRouterParam } from 'nuxt/server'
import {useServerUsers} from "#server/utils/core/useServerUsers";

export default defineEventHandler(async event => {
	const userId = getRouterParam(event, 'userId', { decode: true })!
	const { deleteUserHandler } = useServerUsers()

	return await deleteUserHandler(event, userId)
})
