import { asc, eq, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
// Relative, not `hub:db`, so this module also loads in `bun test`.
import * as tables from '../../db/schema'
import type { Db } from '../core/settings'

/** The member's own context profiles, then the instance ones, each by name. */
export async function listContextProfiles(db: Db, userId: string) {
	return await db.select().from(tables.contextProfile)
		.where(or(isNull(tables.contextProfile.ownerId), eq(tables.contextProfile.ownerId, userId)))
		.orderBy(sql`${tables.contextProfile.ownerId} is null`, asc(sql`lower(${tables.contextProfile.name})`))
}

/** One context profile, whoever owns it; access is checked with `profileAbilities`. Ids that are not UUIDs find nothing. */
export async function findContextProfile(db: Db, id: string | null | undefined) {
	if (!z.uuid().safeParse(id).success) return undefined
	const [profile] = await db.select().from(tables.contextProfile).where(eq(tables.contextProfile.id, id!))
	return profile
}

/** The context profile a project chat uses: its own, or else its project's; `undefined` outside projects. */
export async function chatContextProfile(db: Db, chat: { projectId: string | null, contextProfileId: string | null }) {
	if (!chat.projectId) return undefined
	const id = chat.contextProfileId
		?? (await db.select({ id: tables.project.contextProfileId }).from(tables.project).where(eq(tables.project.id, chat.projectId)))[0]?.id
	return id ? await findContextProfile(db, id) : undefined
}
