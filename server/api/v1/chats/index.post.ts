import { createError, defineEventHandler, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { z } from 'zod'
import { chatSettingsSchema } from '#shared/utils/chat'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { attachFiles, userMessageSchema } from '#server/utils/chat/turns'
import { assertLaneLimit, newLaneSchema, newLaneValues } from '#server/utils/chat/lanes'
import { projectAbilities } from '#shared/abilities/projectAbilities'
import { authorize } from '#server/utils/core/authorize'
import { findProject } from '#server/utils/project/projects'

const bodySchema = z.object({
	id: z.uuid(),
	message: userMessageSchema,
	settings: chatSettingsSchema.optional(),
	/** The lanes, in order: lane fields, optionally over a profile. */
	models: z.array(newLaneSchema).min(1).max(12),
	/** Hidden from the chat list and deleted when its page is left. */
	temporary: z.boolean().optional(),
	/** Starts the chat in a project. Temporary chats are not offered there. */
	projectId: z.uuid().optional(),
})

/** Creates a chat with its lanes and first message. Each lane's answer is requested with `POST /chats/:id`. */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const { id, message, settings, models, temporary, projectId } = await readValidatedBody(event, bodySchema)
	if (projectId) {
		if (temporary) throw createError({ status: 400, statusText: 'Temporary chats are not offered in projects' })
		await authorize(event, projectAbilities().startChats, await findProject(db, projectId))
	}
	await assertLaneLimit(db, models.filter(fields => fields.enabled !== false).length)
	const lanes = await Promise.all(models.map(async (fields, position) => ({ chatId: id, position, ...await newLaneValues(db, user.id, fields) })))

	return await db.transaction(async (tx) => {
		const [chat] = await tx.insert(schema.chat).values({ id, userId: user.id, settings, temporary, projectId }).onConflictDoNothing().returning()
		const [saved] = chat
			? await tx.insert(schema.message).values({ id: message.id, chatId: id, role: 'user', parts: message.parts }).onConflictDoNothing().returning()
			: []
		if (!chat || !saved) throw createError({ status: 409, statusText: 'This id is already in use' })
		await tx.insert(schema.chatModel).values(lanes)
		await attachFiles(tx, id, saved.id, message.parts)
		const { userId: _, ...view } = chat
		return view
	})
})
