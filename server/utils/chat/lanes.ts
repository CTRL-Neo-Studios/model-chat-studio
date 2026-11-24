import { createError } from 'nuxt/server'
import { and, asc, count, eq, isNull, or } from 'drizzle-orm'
import { z } from 'zod'
import type { LaneFields, NewLane } from '../../../shared/utils/chat'
// Relative, not `hub:db`, so this module also loads in `bun test`.
import * as tables from '../../db/schema'
import { type Db, getSetting } from '../core/settings'
import { assertCharacterUsable } from './characters'

const laneColumns = {
	id: tables.chatModel.id,
	profileId: tables.chatModel.profileId,
	position: tables.chatModel.position,
	enabled: tables.chatModel.enabled,
	name: tables.chatModel.name,
	color: tables.chatModel.color,
	platform: tables.chatModel.platform,
	modelId: tables.chatModel.modelId,
	systemPrompt: tables.chatModel.systemPrompt,
	params: tables.chatModel.params,
	characterId: tables.chatModel.characterId,
}

/** A chat's lanes in their display order. */
export async function listChatModels(db: Db, chatId: string) {
	return await db.select(laneColumns).from(tables.chatModel)
		.where(eq(tables.chatModel.chatId, chatId))
		.orderBy(asc(tables.chatModel.position), asc(tables.chatModel.createdAt))
}

/** One lane of a chat. Ids that are not UUIDs find nothing. */
export async function findChatModel(db: Db, chatId: string, id: string | undefined) {
	if (!z.uuid().safeParse(id).success) return undefined
	const [lane] = await db.select(laneColumns).from(tables.chatModel)
		.where(and(eq(tables.chatModel.id, id!), eq(tables.chatModel.chatId, chatId)))
	return lane
}

/** How many of a chat's lanes answer new messages. */
export async function countEnabledLanes(db: Db, chatId: string) {
	const [row] = await db.select({ count: count() }).from(tables.chatModel)
		.where(and(eq(tables.chatModel.chatId, chatId), eq(tables.chatModel.enabled, true)))
	return row?.count ?? 0
}

/** Refuses a change that would leave more lanes answering than the admin allows (`maxChatModels`). */
export async function assertLaneLimit(db: Db, enabledAfter: number) {
	const max = await getSetting(db, 'maxChatModels')
	if (enabledAfter > max) {
		throw createError({ status: 400, statusText: `At most ${max} models can answer in one chat. Turn one off first.` })
	}
}

/**
 * Lane fields as stored. A model id belongs to the platform that is active when it is chosen, so a lane
 * keeps its model across platform switches only on the platform it was chosen on.
 */
export async function laneValues(db: Db, fields: Partial<LaneFields>) {
	return {
		...fields,
		...(fields.systemPrompt !== undefined && { systemPrompt: fields.systemPrompt || null }),
		...(fields.modelId !== undefined && { platform: fields.modelId ? await getSetting(db, 'inferencePlatform') : null }),
	}
}

/**
 * The values of a new lane. From a profile, the lane copies it (and keeps its id, for "Apply to profile");
 * the given fields apply on top. Only the member's own profiles and Characters, and the instance ones, can be used.
 */
export async function newLaneValues(db: Db, userId: string, { profileId, ...fields }: NewLane) {
	let base = {}
	if (profileId) {
		const [profile] = await db.select().from(tables.modelProfile).where(and(
			eq(tables.modelProfile.id, profileId),
			or(isNull(tables.modelProfile.ownerId), eq(tables.modelProfile.ownerId, userId)),
		))
		if (!profile) throw createError({ status: 404, statusText: 'Profile not found' })
		const { name, color, platform, modelId, systemPrompt, params, characterId } = profile
		base = { profileId, name, color, platform, modelId, systemPrompt, params, characterId }
	}
	await assertCharacterUsable(db, userId, fields.characterId)
	return { ...base, ...await laneValues(db, fields) }
}
