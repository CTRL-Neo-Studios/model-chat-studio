// Throwaway: phase 8 layout check. Delete afterwards.
import { defineEventHandler, getQuery, sendRedirect } from 'nuxt/server'
import { db, schema } from 'hub:db'

export default defineEventHandler(async (event) => {
	const githubId = Number(getQuery(event).githubId ?? 1)
	const username = `user${githubId}`
	const [user] = await db.insert(schema.user).values({ githubId, username, name: `Tester ${githubId}`, role: githubId === 1 ? 'admin' : 'user' })
		.onConflictDoUpdate({ target: schema.user.githubId, set: { username } }).returning()
	await replaceUserSession(event, { user: { id: user!.id, role: user!.role, username, name: user!.name, avatar: null } })
	return sendRedirect(event, String(getQuery(event).to ?? '/'))
})
