import { expect, test } from 'bun:test'
import { asc } from 'drizzle-orm'
import * as schema from '../server/db/schema'
import { createTestDb } from './db'

test('0002 gives every chat one lane with its model, settings and system prompt; its answers belong to that lane', async () => {
	const db = await createTestDb({
		tag: '0002_chat_lanes',
		seed: client => client.exec(`
			INSERT INTO "setting" ("key", "value") VALUES ('inferencePlatform', '"openrouter"');
			INSERT INTO "user" ("id", "githubId", "username") VALUES ('00000000-0000-4000-8000-000000000001', 1, 'u');
			INSERT INTO "chat" ("id", "userId", "systemPrompt", "params") VALUES
				('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 'Be brief.', '{"model":"deepseek-flash","webSearch":true,"temperature":0.5}'),
				('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000001', NULL, NULL),
				('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-000000000001', NULL, '{"model":"openai/gpt-5-mini"}');
			INSERT INTO "message" ("id", "chatId", "role", "parts", "metadata") VALUES
				('u1', '00000000-0000-4000-8000-0000000000a1', 'user', '[]', NULL),
				('a1', '00000000-0000-4000-8000-0000000000a1', 'assistant', '[]', '{"platform":"deepseek","model":"deepseek-flash"}');
		`),
	})

	const chats = await db.select({ id: schema.chat.id, settings: schema.chat.settings }).from(schema.chat).orderBy(asc(schema.chat.id))
	expect(chats.map(chat => chat.settings)).toEqual([{ webSearch: true }, {}, {}])

	const lanes = await db.select().from(schema.chatModel).orderBy(asc(schema.chatModel.chatId))
	expect(lanes.map(({ chatId, position, enabled, platform, modelId, systemPrompt, params }) => ({ chatId, position, enabled, platform, modelId, systemPrompt, params }))).toEqual([
		// The platform of the chat's last answer.
		{ chatId: chats[0]!.id, position: 0, enabled: true, platform: 'deepseek', modelId: 'deepseek-flash', systemPrompt: 'Be brief.', params: { temperature: 0.5 } },
		// No model chosen: the default model of whichever platform is active.
		{ chatId: chats[1]!.id, position: 0, enabled: true, platform: null, modelId: null, systemPrompt: null, params: {} },
		// No answers yet: the active platform.
		{ chatId: chats[2]!.id, position: 0, enabled: true, platform: 'openrouter', modelId: 'openai/gpt-5-mini', systemPrompt: null, params: {} },
	])

	const messages = await db.select({ id: schema.message.id, chatModelId: schema.message.chatModelId }).from(schema.message).orderBy(asc(schema.message.id))
	expect(messages).toEqual([{ id: 'a1', chatModelId: lanes[0]!.id }, { id: 'u1', chatModelId: null }])
})
