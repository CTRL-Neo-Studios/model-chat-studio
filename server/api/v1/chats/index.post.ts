import { createError, defineEventHandler, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { chatSettingsSchema, newLaneSchema } from '#shared/utils/chat'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { attachFiles, userMessageSchema } from '#server/utils/chat/turns'
import { assertLaneLimit, newLaneValues } from '#server/utils/chat/lanes'
import { libraryAbilities } from '#shared/abilities/libraryAbilities'
import { profileAbilities } from '#shared/abilities/profileAbilities'
import { authorize } from '#server/utils/core/authorize'
import { findLibrary, MAX_CHAT_LIBRARIES } from '#server/utils/library/libraries'
import { findStructureProfile } from '#server/utils/chat/structureProfiles'
import { folderStart } from '#server/utils/chat/folderStart'
import { assertCharacterUsable, charactersById } from '#server/utils/chat/characters'
import { greetingMessages } from '#server/utils/chat/greetings'
import { userPreferencesSchema } from '#shared/utils/preferences'

const bodySchema = z.object({
	id: z.uuid(),
	message: userMessageSchema,
	/** Absent: the folder's defaults, or none. */
	settings: chatSettingsSchema.optional(),
	/** The lanes, in order: lane fields, optionally over a profile. Absent: the folder's defaults. */
	models: z.array(newLaneSchema).min(1).max(12).optional(),
	/** Hidden from the chat list and deleted when its page is left. */
	temporary: z.boolean().optional(),
	/** Libraries every lane reads, in attach order; the person must be able to read each. Absent: the folder's defaults, or none. */
	libraryIds: z.array(z.uuid()).max(MAX_CHAT_LIBRARIES).transform(ids => [...new Set(ids)]).optional(),
	/** One of the person's structure profiles, or an instance one; `null`: none. Absent: the folder's default, or none. */
	structureProfileId: z.uuid().nullable().optional(),
	/** One of the person's folders, to start the chat in. */
	folderId: z.uuid().optional(),
	/** Who the user is in this chat, one of their Characters or an instance one; `null`: nobody. Absent: their default. */
	userCharacterId: z.uuid().nullable().optional(),
	/** `group`: the lanes share one thread and answer in turn. Fixed once the chat exists. Absent: the folder's, or separate. */
	mode: z.enum(['separate', 'group']).optional(),
})

/**
 * Creates a chat with its lanes, the greetings of their Characters (`greetingMessages`) and its first message. Each
 * lane's answer is requested with `POST /chats/:id`. In a folder, what the request leaves out comes from the folder's
 * defaults (`folderStart`).
 */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const body = await readValidatedBody(event, bodySchema)
	const { id, message, temporary, folderId } = body
	if (folderId && temporary) throw createError({ status: 400, statusText: 'A temporary chat is not kept in a folder' })
	const start = folderId ? await folderStart(db, user, folderId) : undefined
	if (start === null) throw createError({ status: 404, statusText: 'Folder not found' })
	const defaults = start?.defaults
	const models = body.models ?? defaults?.models
	if (!models) throw createError({ status: 400, statusText: 'Choose at least one model' })
	// A group asked for in the request needs two models; one from the folder's defaults already had them checked.
	const mode = body.mode ?? defaults?.mode
	if (mode === 'group' && models.length < 2) throw createError({ status: 400, statusText: 'A group chat needs at least two models' })
	const settings = body.settings ?? defaults?.settings
	const libraryIds = body.libraryIds ?? defaults?.libraryIds ?? []
	const structureProfileId = body.structureProfileId !== undefined ? body.structureProfileId : defaults?.structureProfileId ?? null
	for (const libraryId of libraryIds) await authorize(event, libraryAbilities().readLibrary, await findLibrary(db, libraryId))
	if (structureProfileId) await authorize(event, profileAbilities().readProfile, await findStructureProfile(db, structureProfileId))
	// Absent: the folder's, else the member's default Character, while they may still use it.
	const preferred = userPreferencesSchema.parse(user.preferences ?? {}).characterId
	const userCharacterId = body.userCharacterId !== undefined
		? body.userCharacterId
		: defaults?.userCharacterId !== undefined
			? defaults.userCharacterId
			: preferred && await assertCharacterUsable(db, user.id, preferred).then(() => preferred, () => null)
	await assertCharacterUsable(db, user.id, userCharacterId)
	await assertLaneLimit(db, models.filter(fields => fields.enabled !== false).length)
	const lanes = await Promise.all(models.map(async (fields, position) => ({ id: crypto.randomUUID(), chatId: id, position, ...await newLaneValues(db, user.id, fields) })))
	const characters = await charactersById(db, [...lanes.map(lane => lane.characterId ?? null), userCharacterId ?? null])
	const greetings = greetingMessages({
		chatId: id,
		lanes: lanes.map(lane => ({ id: lane.id, enabled: lane.enabled ?? true, color: lane.color ?? null, characterId: lane.characterId ?? null })),
		characters,
		userName: (userCharacterId && characters[userCharacterId]?.name) || user.name || user.username,
		group: mode === 'group',
	})

	return await db.transaction(async (tx) => {
		const [chat] = await tx.insert(schema.chat).values({ id, userId: user.id, settings, temporary, folderId, structureProfileId, userCharacterId, mode }).onConflictDoNothing().returning()
		if (!chat) throw createError({ status: 409, statusText: 'This id is already in use' })
		await tx.insert(schema.chatModel).values(lanes)
		// The greetings open the chat, so they are saved before its first message.
		if (greetings.length) await tx.insert(schema.message).values(greetings)
		const [saved] = await tx.insert(schema.message).values({ id: message.id, chatId: id, role: 'user', userId: user.id, parts: message.parts }).onConflictDoNothing().returning()
		if (!saved) throw createError({ status: 409, statusText: 'This id is already in use' })
		// The first message is the tip; the chat row comes first, so it is set once the message exists.
		await tx.update(schema.chat).set({ leafId: saved.id }).where(eq(schema.chat.id, id))
		// Attach order is `createdAt`; one statement would give every row the same time.
		const now = Date.now()
		if (libraryIds.length) await tx.insert(schema.chatLibrary).values(libraryIds.map((libraryId, index) => ({ chatId: id, libraryId, createdAt: new Date(now + index) })))
		await attachFiles(tx, id, saved.id, message.parts, user.id)
		const { userId: _, ...view } = chat
		return { ...view, leafId: saved.id }
	})
})
