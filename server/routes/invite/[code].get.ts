import { defineEventHandler, getRouterParam, sendRedirect } from 'nuxt/server'
import { db } from 'hub:db'
import { isInviteUsable } from '#server/utils/core/signup'

/** Invite links land here: remember the code for the signup, then sign in with GitHub. */
export default defineEventHandler(async (event) => {
	const session = await getUserSession(event)
	if (session.user) return sendRedirect(event, '/')

	const code = getRouterParam(event, 'code', { decode: true }) ?? ''
	if (!(await isInviteUsable(db, code))) return sendRedirect(event, '/signin?error=invite_invalid')

	await setUserSession(event, { secure: { inviteCode: code } })
	return sendRedirect(event, '/auth/github')
})
