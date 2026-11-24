import { getRouterParam, type RequestEvent } from 'nuxt/server'
import { db } from 'hub:db'
import { chatAbilities } from '#shared/abilities/chatAbilities'
import { authorize } from '../core/authorize'
import { useServerAuth } from '../core/useServerAuth'
import { findChat } from './turns'

/**
 * The chat in the route's `id`, once the ability allows it. The user loads alongside the chat, so a later
 * `requireUser` costs nothing. Anyone who may not read the chat is told it does not exist.
 */
export async function requireChat(event: RequestEvent, ability: 'readChat' | 'manageChat') {
	const [chat] = await Promise.all([findChat(db, getRouterParam(event, 'id', { decode: true })), useServerAuth().getUser(event)])
	await authorize(event, chatAbilities()[ability], chat)
	return chat!
}
