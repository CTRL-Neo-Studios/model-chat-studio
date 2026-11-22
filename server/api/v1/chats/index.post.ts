import { createError, defineEventHandler, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { z } from 'zod'
import { chatSettingsSchema } from '#shared/utils/chat'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { attachFiles, userMessageSchema } from '#server/utils/chat/turns'
import { assertLaneLimit, newLaneSchema, newLaneValues } from '#server/utils/chat/lanes'
import { libraryAbilities } from '#shared/abilities/libraryAbilities'
import { profileAbilities } from '#shared/abilities/profileAbilities'
import { authorize } from '#server/utils/core/authorize'
import { findLibrary, MAX_CHAT_LIBRARIES } from '#server/utils/library/libraries'
import { findStructureProfile } from '#server/utils/chat/structureProfiles'
import { listFolders } from '#server/utils/chat/folders'
import { nearestDefaults } from '#shared/utils/folderDefaults'
import { allows } from 'nuxt-authorization/utils'
import { assertCharacterUsable } from '#server/utils/chat/characters'
import { userPreferencesSchema } from '#shared/utils/preferences'

const bodySchema = z.object({
	id: z.uuid(),
	message: userMessageSchema,
	settings: chatSettingsSchema.optional(),
	/** The lanes, in order: lane fields, optionally over a profile. */
	models: z.array(newLaneSchema).min(1).max(12),
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
})

/** Creates a chat with its lanes and first message. Each lane's answer is requested with `POST /chats/:id`. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const body = await readValidatedBody(event, bodySchema)
	const { id, message, settings, models, temporary, folderId } = body
	let { libraryIds, structureProfileId } = body
	if (folderId) {
		if (temporary) throw createError({ status: 400, statusText: 'A temporary chat is not kept in a folder' })
		const folders = await listFolders(db, user.id)
		if (!folders.some(folder => folder.id === folderId)) throw createError({ status: 404, statusText: 'Folder not found' })
		// What the request leaves out comes from the folder's defaults, skipping what the member may no longer use.
		const defaults = nearestDefaults(folders, folderId)
		if (defaults && libraryIds === undefined) {
			const found = await Promise.all(defaults.libraryIds.map(libraryId => findLibrary(db, libraryId)))
			const usable = await Promise.all(found.map(library => allows(libraryAbilities().readLibrary, user, library)))
			libraryIds = found.flatMap((library, index) => library && usable[index] ? [library.id] : [])
		}
		if (defaults?.structureProfileId && structureProfileId === undefined) {
			const profile = await findStructureProfile(db, defaults.structureProfileId)
			structureProfileId = profile && await allows(profileAbilities().readProfile, user, profile) ? profile.id : null
		}
	}
	libraryIds ??= []
	for (const libraryId of libraryIds) await authorize(event, libraryAbilities().readLibrary, await findLibrary(db, libraryId))
	if (structureProfileId) await authorize(event, profileAbilities().readProfile, await findStructureProfile(db, structureProfileId))
	// Absent: the member's default Character, while they may still use it.
	const preferred = userPreferencesSchema.parse(user.preferences ?? {}).characterId
	const userCharacterId = body.userCharacterId !== undefined
		? body.userCharacterId
		: preferred && await assertCharacterUsable(db, user.id, preferred).then(() => preferred, () => null)
	await assertCharacterUsable(db, user.id, userCharacterId)
	await assertLaneLimit(db, models.filter(fields => fields.enabled !== false).length)
	const lanes = await Promise.all(models.map(async (fields, position) => ({ chatId: id, position, ...await newLaneValues(db, user.id, fields) })))

	return await db.transaction(async (tx) => {
		const [chat] = await tx.insert(schema.chat).values({ id, userId: user.id, settings, temporary, folderId, structureProfileId, userCharacterId }).onConflictDoNothing().returning()
		const [saved] = chat
			? await tx.insert(schema.message).values({ id: message.id, chatId: id, role: 'user', parts: message.parts }).onConflictDoNothing().returning()
			: []
		if (!chat || !saved) throw createError({ status: 409, statusText: 'This id is already in use' })
		await tx.insert(schema.chatModel).values(lanes)
		// Attach order is `createdAt`; one statement would give every row the same time.
		const now = Date.now()
		if (libraryIds.length) await tx.insert(schema.chatLibrary).values(libraryIds.map((libraryId, index) => ({ chatId: id, libraryId, createdAt: new Date(now + index) })))
		await attachFiles(tx, id, saved.id, message.parts)
		const { userId: _, ...view } = chat
		return view
	})
})
