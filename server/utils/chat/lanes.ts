import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { LaneFields } from '../../../shared/utils/chat'
// Relative, not `hub:db`, so this module also loads in `bun test`.
import * as tables from '../../db/schema'
import { type Db, getSetting } from '../core/settings'

const laneColumns = {
	id: tables.chatModel.id,
	position: tables.chatModel.position,
	enabled: tables.chatModel.enabled,
	name: tables.chatModel.name,
	color: tables.chatModel.color,
	platform: tables.chatModel.platform,
	modelId: tables.chatModel.modelId,
	systemPrompt: tables.chatModel.systemPrompt,
	params: tables.chatModel.params,
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
