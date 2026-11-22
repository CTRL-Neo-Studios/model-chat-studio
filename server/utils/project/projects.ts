import { createError } from 'nuxt/server'
import { and, asc, eq, getTableColumns, sql } from 'drizzle-orm'
import { z } from 'zod'
// Relative, not `hub:db`, so this module also loads in `bun test`.
import * as tables from '../../db/schema'
import type { Db } from '../core/settings'
import { assertFolderParent } from '../chat/folders'

export const projectNameSchema = z.string().trim().min(1).max(100)
export const projectDescriptionSchema = z.string().trim().max(2000)

/** Paths are folder names joined by `/`, so a name cannot hold one. */
export const entryNameSchema = z.string().trim().min(1).max(255)
	.refine(name => !name.includes('/') && name !== '.' && name !== '..', 'A name cannot contain "/" or be "." or ".."')

export const tagsSchema = z.array(z.string().trim().min(1).max(50)).max(20).transform(tags => [...new Set(tags)])

export const noteContentSchema = z.string().max(200_000)

/** A project, or `undefined`; ids that are not UUIDs find nothing. */
export async function findProject(db: Db, id: string | undefined) {
	if (!z.uuid().safeParse(id).success) return undefined
	const [project] = await db.select().from(tables.project).where(eq(tables.project.id, id!))
	return project
}

/** The project whose file space holds an upload, or `undefined` for a chat attachment. */
export async function findFileProject(db: Db, fileId: string) {
	const [row] = await db.select({ project: tables.project }).from(tables.projectEntry)
		.innerJoin(tables.project, eq(tables.project.id, tables.projectEntry.projectId))
		.where(eq(tables.projectEntry.fileId, fileId))
	return row?.project
}

/** A project's file space as a flat list, folders first, then by name. Note text is left out. */
export async function listEntries(db: Db, projectId: string) {
	return await db.select({
		id: tables.projectEntry.id,
		parentId: tables.projectEntry.parentId,
		kind: tables.projectEntry.kind,
		name: tables.projectEntry.name,
		tags: tables.projectEntry.tags,
		fileId: tables.projectEntry.fileId,
		mediaType: tables.file.mediaType,
		size: tables.file.size,
		/** Characters of a note's text. */
		noteLength: sql<number | null>`char_length(${tables.projectEntry.content})`.mapWith(Number),
		updatedAt: tables.projectEntry.updatedAt,
	}).from(tables.projectEntry)
		.leftJoin(tables.file, eq(tables.file.id, tables.projectEntry.fileId))
		.where(eq(tables.projectEntry.projectId, projectId))
		.orderBy(sql`${tables.projectEntry.kind} <> 'folder'`, asc(sql`lower(${tables.projectEntry.name})`))
}

/** An entry's columns as routes return them: the search columns stay on the server. */
const { searchText: _searchText, searchVector: _searchVector, ...columns } = getTableColumns(tables.projectEntry)
export const entryColumns = columns

/** One entry of a project, note text included, or `undefined`. */
export async function findEntry(db: Db, projectId: string, id: string | undefined) {
	if (!z.uuid().safeParse(id).success) return undefined
	const [entry] = await db.select(entryColumns).from(tables.projectEntry)
		.where(and(eq(tables.projectEntry.id, id!), eq(tables.projectEntry.projectId, projectId)))
	return entry
}

interface EntryNode { id: string, parentId: string | null, kind: string }

/** Refuses a parent that is not a folder of this project and, for a move, the entry itself or anything inside it. */
export function assertEntryParent(entries: EntryNode[], parentId: string | null, movingId?: string) {
	assertFolderParent(entries.filter(entry => entry.kind === 'folder'), parentId, movingId)
}

/** Each entry's path in the file space: folder names and its own, joined by `/`. */
export function entryPaths(entries: (EntryNode & { name: string })[]): Record<string, string> {
	const byId = Object.fromEntries(entries.map(entry => [entry.id, entry]))
	const paths: Record<string, string> = {}
	const pathOf = (entry: EntryNode & { name: string }, depth: number): string => {
		const parent = entry.parentId ? byId[entry.parentId] : undefined
		// Bounded, so a cycle left by two concurrent moves cannot loop forever.
		return parent && depth < entries.length ? `${paths[parent.id] ?? pathOf(parent, depth + 1)}/${entry.name}` : entry.name
	}
	for (const entry of entries) paths[entry.id] = pathOf(entry, 0)
	return paths
}

/** Finds a project's entries by path, case-insensitive and with or without slashes at the ends. */
export async function pathResolver(db: Db, projectId: string) {
	const entries = await listEntries(db, projectId)
	const paths = entryPaths(entries)
	const byPath = Object.fromEntries(entries.map(entry => [paths[entry.id]!.toLowerCase(), { entryId: entry.id, kind: entry.kind }]))
	return (path: string) => byPath[path.replace(/^\/+|\/+$/g, '').toLowerCase()]
}

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

/** Runs a write to the file space; a name already used in the folder becomes a 409. */
export async function withUniqueName<T>(write: PromiseLike<T>): Promise<T> {
	try {
		return await write
	}
	catch (error) {
		if (isUniqueViolation(error)) throw createError({ status: 409, statusText: 'This folder already has an entry with that name' })
		throw error
	}
}
