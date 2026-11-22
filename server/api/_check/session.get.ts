import { defineEventHandler, getQuery } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'

// Throwaway: signs in as the first admin, or as `?as=<username>` (created if missing). Delete after the check.
export default defineEventHandler(async (event) => {
	const as = getQuery(event).as
	let [user] = typeof as === 'string'
		? await db.select().from(schema.user).where(eq(schema.user.username, as))
		: await db.select().from(schema.user).where(eq(schema.user.role, 'admin')).orderBy(schema.user.createdAt).limit(1)
	if (!user && typeof as === 'string') [user] = await db.insert(schema.user).values({ githubId: 990000 + as.length * 7 + as.charCodeAt(0), username: as, role: 'user' }).returning()
	if (!user) return 'no user'
	await replaceUserSession(event, { user: { id: user.id, role: user.role, username: user.username, name: user.name, avatar: user.avatarUrl } })
	return { id: user.id }
})
