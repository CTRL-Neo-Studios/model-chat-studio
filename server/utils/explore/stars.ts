import { createError } from 'nuxt/server'
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { z } from 'zod'
// Relative, not `hub:db`, so this module also loads in `bun test`.
import * as tables from '../../db/schema'
import type { Db } from '../core/settings'
import { listingCards } from './browse'

/** A star list's texts. */
export const starListSchema = z.object({
	name: z.string().trim().min(1).max(60),
	description: z.string().trim().max(300),
})

/** Stars a listing, once per member; the count goes up in the same transaction. */
export async function starListing(db: Db, userId: string, listingId: string) {
	await db.transaction(async (tx) => {
		const added = await tx.insert(tables.star).values({ userId, listingId }).onConflictDoNothing().returning()
		if (added.length) await tx.update(tables.listing).set({ stars: sql`${tables.listing.stars} + 1` }).where(eq(tables.listing.id, listingId))
	})
}

/** Takes the member's star away, and with it the listing out of every one of their lists. */
export async function unstarListing(db: Db, userId: string, listingId: string) {
	await db.transaction(async (tx) => {
		const removed = await tx.delete(tables.star).where(and(eq(tables.star.userId, userId), eq(tables.star.listingId, listingId))).returning()
		if (removed.length) await tx.update(tables.listing).set({ stars: sql`${tables.listing.stars} - 1` }).where(eq(tables.listing.id, listingId))
		await tx.delete(tables.starListItem).where(and(
			eq(tables.starListItem.listingId, listingId),
			inArray(tables.starListItem.listId, tx.select({ id: tables.starList.id }).from(tables.starList).where(eq(tables.starList.userId, userId))),
		))
	})
}

/** One of the member's lists; anyone else's is not found. */
async function ownList(db: Db, userId: string, listId: string | undefined) {
	const [list] = z.uuid().safeParse(listId).success
		? await db.select().from(tables.starList).where(and(eq(tables.starList.id, listId!), eq(tables.starList.userId, userId)))
		: []
	if (!list) throw createError({ status: 404, statusText: 'List not found' })
	return list
}

export async function createList(db: Db, userId: string, texts: z.output<typeof starListSchema>) {
	const [list] = await db.insert(tables.starList).values({ userId, ...texts }).returning()
	return list!
}

export async function changeList(db: Db, userId: string, listId: string | undefined, texts: Partial<z.output<typeof starListSchema>>) {
	const list = await ownList(db, userId, listId)
	const [changed] = await db.update(tables.starList).set(texts).where(eq(tables.starList.id, list.id)).returning()
	return changed!
}

/** Deletes a list; the listings in it stay starred. */
export async function deleteList(db: Db, userId: string, listId: string | undefined) {
	const list = await ownList(db, userId, listId)
	await db.delete(tables.starList).where(eq(tables.starList.id, list.id))
}

/** Puts a listing in one of the member's lists, which stars it. */
export async function addToList(db: Db, userId: string, listId: string | undefined, listingId: string) {
	const list = await ownList(db, userId, listId)
	await starListing(db, userId, listingId)
	await db.insert(tables.starListItem).values({ listId: list.id, listingId }).onConflictDoNothing()
}

/** Takes a listing out of one list; it stays starred. */
export async function removeFromList(db: Db, userId: string, listId: string | undefined, listingId: string) {
	const list = await ownList(db, userId, listId)
	await db.delete(tables.starListItem).where(and(eq(tables.starListItem.listId, list.id), eq(tables.starListItem.listingId, listingId)))
}

/**
 * The member's stars, newest first, as cards (one no longer shown on Explore keeps only its name and kind), and their
 * lists in the order made, each with its listings, newest first.
 */
export async function myStars(db: Db, userId: string) {
	const [cards, lists, items] = await Promise.all([
		listingCards(db, userId).where(isNotNull(tables.star.userId)).orderBy(desc(tables.star.createdAt)),
		db.select().from(tables.starList).where(eq(tables.starList.userId, userId)).orderBy(asc(tables.starList.createdAt)),
		db.select({ listId: tables.starListItem.listId, listingId: tables.starListItem.listingId }).from(tables.starListItem)
			.innerJoin(tables.starList, eq(tables.starList.id, tables.starListItem.listId))
			.where(eq(tables.starList.userId, userId)).orderBy(desc(tables.starListItem.createdAt)),
	])
	return {
		listings: cards.map(card => card.available ? card : { ...card, summary: '', tags: [], category: null, avatarFileId: null }),
		lists: lists.map(list => ({ ...list, listingIds: items.filter(item => item.listId === list.id).map(item => item.listingId) })),
	}
}
