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

test('0014 turns projects into libraries attached to their chats, keeps their files, people and profiles', async () => {
	const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
	const db = await createTestDb({
		tag: '0014_libraries',
		seed: client => client.exec(`
			INSERT INTO "user" ("id", "githubId", "username") VALUES ('${u(1)}', 1, 'owner'), ('${u(2)}', 2, 'member'), ('${u(3)}', 3, 'editor');
			INSERT INTO "contextProfile" ("id", "ownerId", "name", "blocks") VALUES ('${u(10)}', '${u(1)}', 'Default', '[{"id":"h","kind":"history"}]'), ('${u(11)}', '${u(1)}', 'Own', '[{"id":"h","kind":"history"}]');
			INSERT INTO "project" ("id", "ownerId", "name", "contextProfileId") VALUES ('${u(20)}', '${u(1)}', 'P', '${u(10)}');
			INSERT INTO "projectMember" ("projectId", "userId", "role") VALUES ('${u(20)}', '${u(2)}', 'member'), ('${u(20)}', '${u(3)}', 'editor');
			INSERT INTO "projectEntry" ("id", "projectId", "parentId", "kind", "name", "content") VALUES ('${u(30)}', '${u(20)}', NULL, 'folder', 'docs', NULL), ('${u(31)}', '${u(20)}', '${u(30)}', 'note', 'plan.md', 'PLAN');
			INSERT INTO "chatFolder" ("id", "userId", "name", "projectId") VALUES ('${u(40)}', '${u(1)}', 'In the project', '${u(20)}');
			INSERT INTO "chat" ("id", "userId", "projectId", "contextProfileId", "folderId") VALUES
				('${u(50)}', '${u(1)}', '${u(20)}', NULL, '${u(40)}'),
				('${u(51)}', '${u(1)}', '${u(20)}', '${u(11)}', NULL),
				('${u(52)}', '${u(1)}', NULL, NULL, NULL);
			INSERT INTO "pin" ("userId", "kind", "targetId") VALUES ('${u(1)}', 'project', '${u(20)}'), ('${u(1)}', 'contextProfile', '${u(10)}');
		`),
	})

	expect(await db.select({ id: schema.library.id, name: schema.library.name }).from(schema.library)).toEqual([{ id: u(20), name: 'P' }])
	// A member could start chats; with no such role left, they read.
	expect(await db.select({ userId: schema.libraryMember.userId, role: schema.libraryMember.role }).from(schema.libraryMember).orderBy(asc(schema.libraryMember.userId)))
		.toEqual([{ userId: u(2), role: 'viewer' }, { userId: u(3), role: 'editor' }])
	expect(await db.select({ id: schema.libraryEntry.id, parentId: schema.libraryEntry.parentId, content: schema.libraryEntry.content }).from(schema.libraryEntry).orderBy(asc(schema.libraryEntry.id)))
		.toEqual([{ id: u(30), parentId: null, content: null }, { id: u(31), parentId: u(30), content: 'PLAN' }])
	expect(await db.select({ chatId: schema.chatLibrary.chatId, libraryId: schema.chatLibrary.libraryId }).from(schema.chatLibrary).orderBy(asc(schema.chatLibrary.chatId)))
		.toEqual([{ chatId: u(50), libraryId: u(20) }, { chatId: u(51), libraryId: u(20) }])
	// The project's default profile, unless the chat had its own; the project folder stays an ordinary one.
	expect(await db.select({ id: schema.chat.id, structureProfileId: schema.chat.structureProfileId, folderId: schema.chat.folderId }).from(schema.chat).orderBy(asc(schema.chat.id)))
		.toEqual([{ id: u(50), structureProfileId: u(10), folderId: u(40) }, { id: u(51), structureProfileId: u(11), folderId: null }, { id: u(52), structureProfileId: null, folderId: null }])
	expect((await db.select({ kind: schema.pin.kind }).from(schema.pin)).map(pin => pin.kind).sort()).toEqual(['library', 'structureProfile'])
})

test('0019 chains each user message and summary to the user message before it, and makes the last one the tip', async () => {
	const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
	// Before: a user message's parent was the newest message when it was sent (an answer, a summary), a summary had none.
	const db = await createTestDb({
		tag: '0019_conversation_tree',
		seed: client => client.exec(`
			INSERT INTO "user" ("id", "githubId", "username") VALUES ('${u(1)}', 1, 'u');
			INSERT INTO "chat" ("id", "userId") VALUES ('${u(2)}', '${u(1)}'), ('${u(3)}', '${u(1)}');
			INSERT INTO "message" ("id", "chatId", "role", "parts", "parentId") VALUES
				('u1', '${u(2)}', 'user', '[]', NULL),
				('a1', '${u(2)}', 'assistant', '[]', 'u1'),
				('u2', '${u(2)}', 'user', '[]', 'a1'),
				('s2', '${u(2)}', 'system', '[]', NULL),
				('u3', '${u(2)}', 'user', '[]', 's2'),
				('a1x', '${u(2)}', 'assistant', '[]', 'u1');
		`),
	})
	expect(Object.fromEntries((await db.select({ id: schema.message.id, parentId: schema.message.parentId }).from(schema.message)).map(row => [row.id, row.parentId])))
		.toEqual({ u1: null, a1: 'u1', u2: 'u1', s2: 'u2', u3: 'u2', a1x: 'u1' })
	expect(await db.select({ id: schema.chat.id, leafId: schema.chat.leafId }).from(schema.chat).orderBy(asc(schema.chat.id)))
		.toEqual([{ id: u(2), leafId: 'u3' }, { id: u(3), leafId: null }])
})

test('0022 makes existing shares viewers and the chat\'s owner the sender of its user messages', async () => {
	const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
	const db = await createTestDb({
		tag: '0022_shared_editing',
		seed: client => client.exec(`
			INSERT INTO "user" ("id", "githubId", "username") VALUES ('${u(1)}', 1, 'owner'), ('${u(2)}', 2, 'reader');
			INSERT INTO "chat" ("id", "userId") VALUES ('${u(3)}', '${u(1)}');
			INSERT INTO "chatShare" ("chatId", "userId") VALUES ('${u(3)}', '${u(2)}');
			INSERT INTO "message" ("id", "chatId", "role", "parts", "parentId") VALUES
				('u1', '${u(3)}', 'user', '[]', NULL),
				('a1', '${u(3)}', 'assistant', '[]', 'u1'),
				('s1', '${u(3)}', 'system', '[]', 'u1');
		`),
	})
	expect(await db.select({ role: schema.chatShare.role }).from(schema.chatShare)).toEqual([{ role: 'viewer' }])
	expect(Object.fromEntries((await db.select({ id: schema.message.id, userId: schema.message.userId }).from(schema.message)).map(row => [row.id, row.userId])))
		.toEqual({ u1: u(1), a1: null, s1: null })
})
