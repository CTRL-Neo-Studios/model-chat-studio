import { defineEventHandler, getQuery } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq, inArray } from 'drizzle-orm'
import { sealSecret } from '#server/utils/core/secrets'
import { getSetting, setSetting } from '#server/utils/core/settings'
import { captured } from '../../plugins/_fixture'

// Throwaway: signs in as the first admin with OpenRouter active (fake keys); `?captured` returns and clears what the
// fixture platform was sent; `?traces=<chatId>` lists that chat's traces. Delete after the check.
export default defineEventHandler(async (event) => {
	const query = getQuery(event)
	if (query.captured !== undefined) {
		const calls = captured.splice(0).map(call => call.messages.map(message => `${message.role}:${typeof message.content === 'string' ? message.content : JSON.stringify(message.content)}`.slice(0, 60)))
		return calls
	}
	if (typeof query.traces === 'string') {
		const ids = (await db.select({ id: schema.message.id }).from(schema.message).where(eq(schema.message.chatId, query.traces))).map(row => row.id)
		return ids.length ? await db.select().from(schema.turnTrace).where(inArray(schema.turnTrace.messageId, ids)) : []
	}
	const [user] = await db.select().from(schema.user).where(eq(schema.user.role, 'admin')).limit(1)
	if (!user) return 'no admin'
	await replaceUserSession(event, { user: { id: user.id, role: user.role, username: user.username, name: user.name, avatar: user.avatarUrl } })
	for (const id of ['openrouter', 'deepseek'] as const) {
		const config = await getSetting(db, `inference.${id}`)
		await setSetting(db, `inference.${id}`, { ...config, apiKey: await sealSecret('sk-fake') })
	}
	await setSetting(db, 'inferencePlatform', 'openrouter')
	return 'ok'
})
