import { createError, getRouterParam, type RequestEvent } from 'nuxt/server'
import type { User } from '#shared/types/db'
import { db } from 'hub:db'
import { chatAbilities } from '#shared/abilities/chatAbilities'
import { authorize } from '../core/authorize'
import { useServerAuth } from '../core/useServerAuth'
import { findChat } from './turns'

/**
 * The chat in the route's `id`, once the ability allows it. The user loads alongside the chat, so a later
 * `requireUser` costs nothing. Anyone who may not read the chat is told it does not exist.
 */
export async function requireChat(event: RequestEvent, ability: 'readChat' | 'writeChat' | 'manageChat') {
	const [chat] = await Promise.all([findChat(db, getRouterParam(event, 'id', { decode: true })), useServerAuth().getUser(event)])
	await authorize(event, chatAbilities()[ability], chat)
	return chat!
}

/**
 * The chat's owner, whose setup a turn uses (milestone 11): `{{user}}`, the user's name, the libraries a Character
 * brings. The sender pays; this is only who the chat is about. `sender` is reused when it is the owner.
 */
export async function chatOwner(chat: { userId: string }, sender: User): Promise<User> {
	if (chat.userId === sender.id) return sender
	const owner = await useServerAuth().getDbUserFromId(chat.userId)
	if (!owner) throw createError({ status: 404, statusText: 'Chat not found' })
	return owner
}
