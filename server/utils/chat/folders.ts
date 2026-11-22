import { createError } from 'nuxt/server'
import { and, asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
// Relative, not `hub:db`, so this module also loads in `bun test`.
import * as tables from '../../db/schema'
import type { Db } from '../core/settings'

export const folderNameSchema = z.string().trim().min(1).max(100)

interface FolderNode { id: string, parentId: string | null }

/** All of a member's folders, personal and in projects, by name. A member has few, and moves are checked against the whole tree. */
export async function listFolders(db: Db, userId: string) {
	return await db.select({ id: tables.chatFolder.id, parentId: tables.chatFolder.parentId, name: tables.chatFolder.name, projectId: tables.chatFolder.projectId })
		.from(tables.chatFolder)
		.where(eq(tables.chatFolder.userId, userId))
		.orderBy(asc(sql`lower(${tables.chatFolder.name})`))
}

/**
 * Refuses a parent that is not one of the member's folders and, when a folder is moved (`movingId`), the folder
 * itself or any folder inside it.
 */
export function assertFolderParent(folders: FolderNode[], parentId: string | null, movingId?: string) {
	if (parentId === null) return
	const byId = Object.fromEntries(folders.map(folder => [folder.id, folder]))
	if (!byId[parentId]) throw createError({ status: 404, statusText: 'Folder not found' })
	// Bounded by the number of folders, so a cycle left by two concurrent moves cannot loop forever.
	let id: string | null = parentId
	for (let step = 0; id && step <= folders.length; step++) {
		if (id === movingId) throw createError({ status: 400, statusText: 'A folder cannot move into itself or a folder inside it' })
		id = byId[id]?.parentId ?? null
	}
}

/** Deletes one of the member's folders; its chats and folders move up to its parent. `false` when it is not theirs. */
export async function deleteFolder(db: Db, userId: string, id: string) {
	return await db.transaction(async (tx) => {
		const [folder] = await tx.select().from(tables.chatFolder)
			.where(and(eq(tables.chatFolder.id, id), eq(tables.chatFolder.userId, userId)))
		if (!folder) return false
		await tx.update(tables.chat).set({ folderId: folder.parentId }).where(eq(tables.chat.folderId, id))
		await tx.update(tables.chatFolder).set({ parentId: folder.parentId }).where(eq(tables.chatFolder.parentId, id))
		await tx.delete(tables.chatFolder).where(eq(tables.chatFolder.id, id))
		return true
	})
}
