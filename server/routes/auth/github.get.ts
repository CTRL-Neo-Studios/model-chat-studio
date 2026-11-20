import { sendRedirect } from 'nuxt/server'
import { db } from 'hub:db'
import { signInWithGitHub } from '#server/utils/core/signup'

export default defineOAuthGitHubEventHandler({
	async onSuccess(event, { user: profile }) {
		const session = await getUserSession(event)
		const result = await signInWithGitHub(db, profile, session.secure?.inviteCode)

		if ('error' in result) {
			await clearUserSession(event)
			return sendRedirect(event, `/signin?error=${result.error}`)
		}

		const { user } = result
		if (!satisfies(user)) {
			await clearUserSession(event)
			return sendRedirect(event, '/signin?error=banned')
		}

		// Replaces, not merges: drops the claimed invite code from the session.
		await replaceUserSession(event, {
			user: {
				id: user.id,
				role: user.role,
				username: user.username,
				name: user.name,
				avatar: user.avatarUrl,
			},
		})
		return sendRedirect(event, '/')
	},

	onError(event, error) {
		console.error('[GitHub OAuth]', error)
		return sendRedirect(event, '/signin?error=github')
	},
})
