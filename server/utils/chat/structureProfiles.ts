import { asc, eq, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
// Relative, not `hub:db`, so this module also loads in `bun test`.
import * as tables from '../../db/schema'
import type { Db } from '../core/settings'

/** The member's own structure profiles, then the instance ones, each by name. */
export async function listStructureProfiles(db: Db, userId: string) {
	return await db.select().from(tables.structureProfile)
		.where(or(isNull(tables.structureProfile.ownerId), eq(tables.structureProfile.ownerId, userId)))
		.orderBy(sql`${tables.structureProfile.ownerId} is null`, asc(sql`lower(${tables.structureProfile.name})`))
}

/** One structure profile, whoever owns it; access is checked with `profileAbilities`. Ids that are not UUIDs find nothing. */
export async function findStructureProfile(db: Db, id: string | null | undefined) {
	if (!z.uuid().safeParse(id).success) return undefined
	const [profile] = await db.select().from(tables.structureProfile).where(eq(tables.structureProfile.id, id!))
	return profile
}
