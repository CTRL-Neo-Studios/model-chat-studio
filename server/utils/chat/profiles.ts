import { createError } from 'nuxt/server'
import { asc, eq, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
// Relative, not `hub:db`, so this module also loads in `bun test`.
import * as tables from '../../db/schema'
import type { Db } from '../core/settings'
import { getCatalog, useInference } from '../inference'

/** The member's own profiles, then the instance profiles, each by name. */
export async function listModelProfiles(db: Db, userId: string) {
	return await db.select().from(tables.modelProfile)
		.where(or(isNull(tables.modelProfile.ownerId), eq(tables.modelProfile.ownerId, userId)))
		.orderBy(sql`${tables.modelProfile.ownerId} is null`, asc(sql`lower(${tables.modelProfile.name})`))
}

/** One profile, whoever owns it; access is checked with `profileAbilities`. Ids that are not UUIDs find nothing. */
export async function findModelProfile(db: Db, id: string | undefined) {
	if (!z.uuid().safeParse(id).success) return undefined
	const [profile] = await db.select().from(tables.modelProfile).where(eq(tables.modelProfile.id, id!))
	return profile
}

/** A model the member may pick on the active platform, for a profile. */
export async function findOfferedModel(db: Db, userId: string, modelId: string) {
	const inference = await useInference(db, userId)
	if (!inference) throw createError({ status: 503, statusText: 'No model platform is configured yet. An admin can set one up in the settings.' })
	const model = (await getCatalog(db, inference)).find(entry => entry.id === modelId)
	if (!model) throw createError({ status: 400, statusText: 'This model is not offered' })
	return { platform: inference.platform.id, model }
}
