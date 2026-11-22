import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { profileAbilities } from '#shared/abilities/profileAbilities'
import { authorize } from '#server/utils/core/authorize'
import { requireChat } from '#server/utils/chat/access'
import { findChatModel } from '#server/utils/chat/lanes'
import { findModelProfile } from '#server/utils/chat/profiles'
import { assertProfileCharacter } from '#server/utils/chat/characters'

/** Owner only: writes a lane's settings back to the profile it was started from. Other chats' lanes keep theirs. */
export default defineEventHandler(async (event) => {
	const chat = await requireChat(event, 'manageChat')
	const lane = await findChatModel(db, chat.id, getRouterParam(event, 'laneId', { decode: true }))
	if (!lane) throw createError({ status: 404, statusText: 'Model not found in this chat' })
	if (!lane.profileId || !lane.modelId || !lane.platform) throw createError({ status: 400, statusText: 'This model was not started from a profile' })
	const profile = await findModelProfile(db, lane.profileId)
	await authorize(event, profileAbilities().manageProfile, profile)
	await assertProfileCharacter(db, chat.userId, lane.characterId, profile!.ownerId)

	const [updated] = await db.update(schema.modelProfile).set({
		name: lane.name ?? profile!.name,
		color: lane.color,
		platform: lane.platform,
		modelId: lane.modelId,
		systemPrompt: lane.systemPrompt,
		params: lane.params,
		characterId: lane.characterId,
	}).where(eq(schema.modelProfile.id, profile!.id)).returning()
	return updated!
})
