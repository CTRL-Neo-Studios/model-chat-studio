import { createError } from 'nuxt/server'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
// Relative, not `#shared` or `hub:db`, so this module also loads in `bun test`.
import * as tables from '../../db/schema'
import type { Db } from '../core/settings'
import type { FolderDefaults } from '../../../shared/utils/folderDefaults'
import { NO_PACKAGE_ITEMS, NO_PACKAGE_TEXTS, type ExploreSettings, type PackageItems, type PackageTexts } from '../../../shared/utils/package'
import { deleteListing, publishListing } from './listings'
import { ownedItems, type Store } from './package'

type ContentPackage = typeof tables.contentPackage.$inferSelect

/** A package as its owner sees it: the items it still has (one deleted elsewhere drops out). */
const live = async (db: Db, row: ContentPackage) => ({ ...row, items: await ownedItems(db, row.ownerId, row.items) })

/** The member's Content Packages, newest first. */
export async function myPackages(db: Db, userId: string) {
	const rows = await db.select().from(tables.contentPackage).where(eq(tables.contentPackage.ownerId, userId)).orderBy(desc(tables.contentPackage.createdAt))
	return await Promise.all(rows.map(row => live(db, row)))
}

/** One of the member's packages; another member's, or an id that is not one, is not found. */
export async function findPackage(db: Db, userId: string, id: string | undefined) {
	const [row] = z.uuid().safeParse(id).success
		? await db.select().from(tables.contentPackage).where(and(eq(tables.contentPackage.id, id!), eq(tables.contentPackage.ownerId, userId)))
		: []
	if (!row) throw createError({ status: 404, statusText: 'Package not found' })
	return await live(db, row)
}

/** A new, empty package. */
export async function createPackage(db: Db, userId: string, name: string) {
	const [row] = await db.insert(tables.contentPackage).values({ ownerId: userId, name, items: NO_PACKAGE_ITEMS, texts: NO_PACKAGE_TEXTS }).returning()
	return row!
}

/**
 * Changes a package: its name, items, setup or texts. Every item must be the member's own (one that is not is not
 * found, as when publishing); items deleted elsewhere drop out of what is stored.
 */
export async function changePackage(db: Db, userId: string, id: string | undefined, patch: { name?: string, items?: PackageItems, setup?: FolderDefaults | null, texts?: PackageTexts }) {
	const current = await findPackage(db, userId, id)
	const items = patch.items ? await ownedItems(db, userId, patch.items) : current.items
	if (patch.items) {
		const missing = (['characterIds', 'libraryIds', 'structureProfileIds'] as const).find(kind => items[kind].length < patch.items![kind].length)
		if (missing) throw createError({ status: 404, statusText: `${{ characterIds: 'Character', libraryIds: 'Library', structureProfileIds: 'Structure profile' }[missing]} not found` })
	}
	const [row] = await db.update(tables.contentPackage).set({ ...patch, items, updatedAt: new Date() }).where(eq(tables.contentPackage.id, current.id)).returning()
	return row!
}

/** Deletes a package and, when it was published, its listing with its versions. Copies people got stay theirs. */
export async function deletePackage(db: Db, store: Store, userId: string, id: string | undefined) {
	const found = await findPackage(db, userId, id)
	if (found.listingId) await deleteListing(db, store, found.listingId)
	await db.delete(tables.contentPackage).where(eq(tables.contentPackage.id, found.id))
}

/**
 * Publishes a draft package: a listing of its name and texts, taken from it (`source: { packageId }`), linked to it in
 * the same transaction. Updates are the listing's own ("Publish an update" reads the package as it is then). A package
 * already published is refused.
 */
export async function publishPackage(db: Db, store: Store, input: { userId: string, packageId: string | undefined, settings: ExploreSettings }) {
	const found = await findPackage(db, input.userId, input.packageId)
	if (found.listingId) throw createError({ status: 409, statusText: 'This package is on Explore already: publish an update instead' })
	return await publishListing(db, store, {
		userId: input.userId,
		texts: { name: found.name, ...found.texts },
		source: { packageId: found.id },
		settings: input.settings,
		link: (tx, listingId) => tx.update(tables.contentPackage).set({ listingId }).where(eq(tables.contentPackage.id, found.id)),
	})
}
