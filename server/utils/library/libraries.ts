import { createError } from 'nuxt/server'
import { and, asc, eq, getTableColumns, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
// Relative, not `hub:db`, so this module also loads in `bun test`.
import * as tables from '../../db/schema'
import type { Db } from '../core/settings'
import { assertFolderParent } from '../chat/folders'
import type { LibraryRole } from '../../../shared/abilities/libraryAbilities'
import { type LibraryRef, spaceEntries } from '../../../shared/utils/librarySpace'

/** The people a library is shared with, by id, with their role. */
export async function libraryMembers(db: Db, libraryId: string): Promise<Record<string, LibraryRole>> {
	const rows = await db.select({ userId: tables.libraryMember.userId, role: tables.libraryMember.role }).from(tables.libraryMember)
		.where(eq(tables.libraryMember.libraryId, libraryId))
	return Object.fromEntries(rows.map(row => [row.userId, row.role]))
}

/** A library with the people it is shared with (`members`), or `undefined`; ids that are not UUIDs find nothing. */
export async function findLibrary(db: Db, id: string | null | undefined) {
	if (!z.uuid().safeParse(id).success) return undefined
	const [[library], members] = await Promise.all([
		db.select().from(tables.library).where(eq(tables.library.id, id!)),
		libraryMembers(db, id!),
	])
	return library && { ...library, members }
}

/** The library that holds an upload, with its people, or `undefined` for a chat attachment. */
export async function findFileLibrary(db: Db, fileId: string) {
	const [row] = await db.select({ id: tables.libraryEntry.libraryId }).from(tables.libraryEntry).where(eq(tables.libraryEntry.fileId, fileId))
	return row ? await findLibrary(db, row.id) : undefined
}

/** The libraries attached to a chat, in attach order, each with its people. */
export async function chatLibraries(db: Db, chatId: string) {
	const rows = await db.select({ id: tables.chatLibrary.libraryId }).from(tables.chatLibrary)
		.where(eq(tables.chatLibrary.chatId, chatId))
		.orderBy(asc(tables.chatLibrary.createdAt))
	const found = await Promise.all(rows.map(row => findLibrary(db, row.id)))
	return found.filter(library => library !== undefined)
}

/** At most this many libraries attach to one chat. */
export const MAX_CHAT_LIBRARIES = 5

/** When someone leaves a library (or is removed): it comes off their chats. */
export async function detachLibrary(db: Db, libraryId: string, userId: string) {
	await db.delete(tables.chatLibrary).where(and(
		eq(tables.chatLibrary.libraryId, libraryId),
		inArray(tables.chatLibrary.chatId, db.select({ id: tables.chat.id }).from(tables.chat).where(eq(tables.chat.userId, userId))),
	))
}

/** A library's files as a flat list, folders first, then by name. Note text is left out. */
export async function listEntries(db: Db, libraryId: string) {
	return await db.select({
		id: tables.libraryEntry.id,
		parentId: tables.libraryEntry.parentId,
		kind: tables.libraryEntry.kind,
		name: tables.libraryEntry.name,
		tags: tables.libraryEntry.tags,
		fileId: tables.libraryEntry.fileId,
		mediaType: tables.file.mediaType,
		size: tables.file.size,
		/** Characters of a note's text. */
		noteLength: sql<number | null>`char_length(${tables.libraryEntry.content})`.mapWith(Number),
		updatedAt: tables.libraryEntry.updatedAt,
	}).from(tables.libraryEntry)
		.leftJoin(tables.file, eq(tables.file.id, tables.libraryEntry.fileId))
		.where(eq(tables.libraryEntry.libraryId, libraryId))
		.orderBy(sql`${tables.libraryEntry.kind} <> 'folder'`, asc(sql`lower(${tables.libraryEntry.name})`))
}

/** An entry's columns as routes return them: the search columns stay on the server. */
const { searchText: _searchText, searchVector: _searchVector, ...columns } = getTableColumns(tables.libraryEntry)
export const entryColumns = columns

/** One entry of a library, note text included, or `undefined`. */
export async function findEntry(db: Db, libraryId: string, id: string | undefined) {
	if (!z.uuid().safeParse(id).success) return undefined
	const [entry] = await db.select(entryColumns).from(tables.libraryEntry)
		.where(and(eq(tables.libraryEntry.id, id!), eq(tables.libraryEntry.libraryId, libraryId)))
	return entry
}

interface EntryNode { id: string, parentId: string | null, kind: string }

/** Refuses a parent that is not a folder of this library and, for a move, the entry itself or anything inside it. */
export function assertEntryParent(entries: EntryNode[], parentId: string | null, movingId?: string) {
	assertFolderParent(entries.filter(entry => entry.kind === 'folder'), parentId, movingId)
}

/** The entries of a chat's libraries with their paths (`spaceEntries`), read now. */
export async function listSpace(db: Db, libraries: LibraryRef[]) {
	const lists = await Promise.all(libraries.map(library => listEntries(db, library.id)))
	return spaceEntries(libraries, lists)
}

export type SpaceEntry = Awaited<ReturnType<typeof listSpace>>[number]

/** An entry and everything inside it. */
export function entrySubtree<T extends EntryNode>(entries: T[], id: string): T[] {
	const found = entries.filter(entry => entry.id === id)
	// Each entry is visited once, so a cycle left by two concurrent moves cannot loop forever.
	const seen: Record<string, true> = { [id]: true }
	for (let i = 0; i < found.length; i++) {
		for (const entry of entries) {
			if (entry.parentId === found[i]!.id && !seen[entry.id]) {
				seen[entry.id] = true
				found.push(entry)
			}
		}
	}
	return found
}

function isUniqueViolation(error: unknown): boolean {
	let current: unknown = error
	while (typeof current === 'object' && current !== null) {
		if ('code' in current && current.code === '23505') return true
		current = 'cause' in current ? current.cause : undefined
	}
	return false
}

/** Runs a write to the library; a name already used in the folder becomes a 409. */
export async function withUniqueName<T>(write: PromiseLike<T>): Promise<T> {
	try {
		return await write
	}
	catch (error) {
		if (isUniqueViolation(error)) throw createError({ status: 409, statusText: 'This folder already has an entry with that name' })
		throw error
	}
}
