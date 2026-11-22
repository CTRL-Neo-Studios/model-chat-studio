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

const bodySchema = z.object({
	id: z.uuid(),
	message: userMessageSchema,
	settings: chatSettingsSchema.optional(),
	/** The lanes, in order: lane fields, optionally over a profile. */
	models: z.array(newLaneSchema).min(1).max(12),
	/** Hidden from the chat list and deleted when its page is left. */
	temporary: z.boolean().optional(),
	/** Libraries every lane reads, in attach order; the person must be able to read each. */
	libraryIds: z.array(z.uuid()).max(MAX_CHAT_LIBRARIES).transform(ids => [...new Set(ids)]).default([]),
	/** One of the person's structure profiles, or an instance one. */
	structureProfileId: z.uuid().optional(),
})

/** Creates a chat with its lanes and first message. Each lane's answer is requested with `POST /chats/:id`. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const { id, message, settings, models, temporary, libraryIds, structureProfileId } = await readValidatedBody(event, bodySchema)
	for (const libraryId of libraryIds) await authorize(event, libraryAbilities().readLibrary, await findLibrary(db, libraryId))
	if (structureProfileId) await authorize(event, profileAbilities().readProfile, await findStructureProfile(db, structureProfileId))
	await assertLaneLimit(db, models.filter(fields => fields.enabled !== false).length)
	const lanes = await Promise.all(models.map(async (fields, position) => ({ chatId: id, position, ...await newLaneValues(db, user.id, fields) })))

	return await db.transaction(async (tx) => {
		const [chat] = await tx.insert(schema.chat).values({ id, userId: user.id, settings, temporary, structureProfileId }).onConflictDoNothing().returning()
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
