import { createError } from 'nuxt/server'
import { asc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
// Relative, not `hub:db`, so this module also loads in `bun test`.
import * as tables from '../../db/schema'
import type { Db } from '../core/settings'
import { allows } from 'nuxt-authorization/utils'
import { findLibrary } from '../library/libraries'
import { libraryAbilities } from '../../../shared/abilities/libraryAbilities'
import type { LibraryRef } from '../../../shared/utils/librarySpace'
import type { User } from '../../../shared/types/db'

/** Each Character's libraries, in attach order. */
async function librariesOf(db: Db, characterIds: string[]): Promise<Record<string, string[]>> {
	if (!characterIds.length) return {}
	const rows = await db.select({ characterId: tables.characterLibrary.characterId, libraryId: tables.characterLibrary.libraryId })
		.from(tables.characterLibrary)
		.where(inArray(tables.characterLibrary.characterId, characterIds))
		.orderBy(asc(tables.characterLibrary.createdAt))
	const byCharacter: Record<string, string[]> = {}
	for (const row of rows) (byCharacter[row.characterId] ??= []).push(row.libraryId)
	return byCharacter
}

/** The member's own Characters, then the instance ones, each by name, with their `libraryIds`. */
export async function listCharacters(db: Db, userId: string) {
	const rows = await db.select().from(tables.character)
		.where(or(isNull(tables.character.ownerId), eq(tables.character.ownerId, userId)))
		.orderBy(sql`${tables.character.ownerId} is null`, asc(sql`lower(${tables.character.name})`))
	const libraries = await librariesOf(db, rows.map(row => row.id))
	return rows.map(row => ({ ...row, libraryIds: libraries[row.id] ?? [] }))
}

/** One Character, whoever owns it, with its `libraryIds`; access is checked with `profileAbilities`. Ids that are not UUIDs find nothing. */
export async function findCharacter(db: Db, id: string | null | undefined) {
	if (!z.uuid().safeParse(id).success) return undefined
	const [row] = await db.select().from(tables.character).where(eq(tables.character.id, id!))
	if (!row) return undefined
	return { ...row, libraryIds: (await librariesOf(db, [row.id]))[row.id] ?? [] }
}

/** Refuses a Character the member may not use: theirs and the instance ones only. */
export async function assertCharacterUsable(db: Db, userId: string, id: string | null | undefined) {
	if (!id) return
	const found = await findCharacter(db, id)
	if (!found || (found.ownerId !== null && found.ownerId !== userId)) throw createError({ status: 404, statusText: 'Character not found' })
}

/**
 * Refuses a profile's default Character the member may not use, and, on an instance profile (`profileOwnerId`
 * `null`), any but an instance Character: every member starts lanes from it.
 */
export async function assertProfileCharacter(db: Db, userId: string, id: string | null | undefined, profileOwnerId: string | null) {
	if (!id) return
	await assertCharacterUsable(db, userId, id)
	if (profileOwnerId === null && (await findCharacter(db, id))?.ownerId !== null) {
		throw createError({ status: 400, statusText: 'An instance profile can only use an instance Character' })
	}
}

/** Replaces a Character's libraries, keeping the given order. */
export async function setCharacterLibraries(db: Db, characterId: string, libraryIds: string[]) {
	await db.delete(tables.characterLibrary).where(eq(tables.characterLibrary.characterId, characterId))
	// Attach order is `createdAt`; one statement would give every row the same time.
	const now = Date.now()
	if (libraryIds.length) await db.insert(tables.characterLibrary).values(libraryIds.map((libraryId, index) => ({ characterId, libraryId, createdAt: new Date(now + index) })))
}

/**
 * The libraries one lane reads: the chat's, then its Character's that `reader` (the chat's owner) may read, each
 * once. A Character's libraries reach only the lane it is on.
 */
export async function laneLibraries(db: Db, reader: User, chatLibraries: LibraryRef[], characterLibraryIds: string[]) {
	const extra = await Promise.all(characterLibraryIds.filter(id => !chatLibraries.some(library => library.id === id)).map(id => findLibrary(db, id)))
	const readable = await Promise.all(extra.map(library => library ? allows(libraryAbilities().readLibrary, reader, library) : false))
	return [...chatLibraries, ...extra.flatMap((library, index) => library && readable[index] ? [{ id: library.id, name: library.name }] : [])]
}

/** Characters by id, for a turn: name, colour, instructions and libraries. */
export async function charactersById(db: Db, ids: (string | null)[]) {
	const wanted = [...new Set(ids.filter(id => id !== null))]
	const rows = wanted.length ? await db.select().from(tables.character).where(inArray(tables.character.id, wanted)) : []
	const libraries = await librariesOf(db, wanted)
	return Object.fromEntries(rows.map(row => [row.id, { ...row, libraryIds: libraries[row.id] ?? [] }]))
}
