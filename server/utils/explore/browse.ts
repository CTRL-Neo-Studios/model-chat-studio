import { and, asc, count, desc, eq, ilike, lte, or, type SQL, sql } from 'drizzle-orm'
import { z } from 'zod'
// Relative, not `#shared` or `hub:db`, so this module also loads in `bun test`.
import * as tables from '../../db/schema'
import type { Db } from '../core/settings'
import { givePackage, type Store } from './package'
import type { Listing } from './listings'

export const PAGE_SIZE = 24

/** The grid's query (milestone 13 plan, section 4): words, filters, a sort, a page. */
export const browseQuerySchema = z.object({
	q: z.string().trim().max(200).optional(),
	kind: z.enum(tables.listingKinds).optional(),
	category: z.string().trim().min(1).max(40).optional(),
	tag: z.string().trim().toLowerCase().min(1).max(30).optional(),
	sort: z.enum(['newest', 'updated', 'gets', 'stars']).default('newest'),
	page: z.coerce.number().int().min(1).max(1000).default(1),
})

export type BrowseQuery = z.output<typeof browseQuerySchema>

// Shown on Explore: listed, and its publisher not banned (a ban with an expiry in the past is over).
const shown = and(
	eq(tables.listing.status, 'listed'),
	or(eq(tables.user.banned, false), lte(tables.user.banExpires, sql`now()`)),
)

/** `%` and `_` in a member's words are themselves, not wildcards. */
const pattern = (word: string) => `%${word.replace(/[\\%_]/g, '\\$&')}%`

/**
 * Cards as the grid and the stars page show them, from `userId`'s side: each with its publisher, its star count and
 * whether they starred it, whether it is still shown on Explore, and the avatar its version owns for its first
 * Character. Callers add the filter and the order.
 */
export function listingCards(db: Db, userId: string) {
	return db.select({
		id: tables.listing.id,
		kind: tables.listing.kind,
		name: tables.listing.name,
		summary: tables.listing.summary,
		tags: tables.listing.tags,
		category: tables.listing.category,
		featured: tables.listing.featured,
		gets: tables.listing.gets,
		stars: tables.listing.stars,
		starred: sql<boolean>`${tables.star.userId} is not null`,
		available: sql<boolean>`coalesce(${shown}, false)`,
		publishedAt: tables.listing.publishedAt,
		updatedAt: tables.listingVersion.createdAt,
		avatarFileId: tables.listingFile.fileId,
		publisher: { username: tables.user.username, name: tables.user.name, avatarUrl: tables.user.avatarUrl },
	}).from(tables.listing)
		.innerJoin(tables.user, eq(tables.user.id, tables.listing.ownerId))
		.innerJoin(tables.listingVersion, eq(tables.listingVersion.id, tables.listing.currentVersionId))
		.leftJoin(tables.listingFile, and(eq(tables.listingFile.versionId, tables.listing.currentVersionId), eq(tables.listingFile.key, sql`${tables.listingVersion.content}->'characters'->0->>'avatarKey'`)))
		.leftJoin(tables.star, and(eq(tables.star.listingId, tables.listing.id), eq(tables.star.userId, userId)))
}

/**
 * One page of Explore: listed listings whose every word is in the name, summary or tags, of a kind, category and
 * tag when given; featured ones first, then by the sort.
 */
export async function browseListings(db: Db, query: BrowseQuery, userId: string) {
	const words = (query.q ?? '').split(/\s+/).filter(Boolean).slice(0, 8)
	const where = and(
		shown,
		...words.map(word => or(ilike(tables.listing.name, pattern(word)), ilike(tables.listing.summary, pattern(word)), sql`${tables.listing.tags}::text ilike ${pattern(word)}`)),
		query.kind ? eq(tables.listing.kind, query.kind) : undefined,
		query.category ? eq(tables.listing.category, query.category) : undefined,
		query.tag ? sql`${tables.listing.tags} @> ${JSON.stringify([query.tag])}::jsonb` : undefined,
	)
	const order: SQL[] = {
		newest: [desc(tables.listing.publishedAt)],
		updated: [desc(tables.listingVersion.createdAt)],
		gets: [desc(tables.listing.gets), desc(tables.listing.publishedAt)],
		stars: [desc(tables.listing.stars), desc(tables.listing.publishedAt)],
	}[query.sort]
	const [rows, [total]] = await Promise.all([
		listingCards(db, userId)
			.where(where)
			.orderBy(desc(tables.listing.featured), ...order, asc(tables.listing.id))
			.limit(PAGE_SIZE)
			.offset((query.page - 1) * PAGE_SIZE),
		db.select({ count: count() }).from(tables.listing).innerJoin(tables.user, eq(tables.user.id, tables.listing.ownerId)).where(where),
	])
	return { listings: rows, total: total?.count ?? 0, pageSize: PAGE_SIZE }
}

/** Each key's stored file in a version: its id (for `/files/:id`) and where it is stored (for copies). */
async function versionFiles(db: Db, versionId: string) {
	const rows = await db.select({ key: tables.listingFile.key, id: tables.file.id, blobPath: tables.file.blobPath }).from(tables.listingFile)
		.innerJoin(tables.file, eq(tables.file.id, tables.listingFile.fileId))
		.where(eq(tables.listingFile.versionId, versionId))
	return Object.fromEntries(rows.map(row => [row.key, row]))
}

/**
 * A listing's page: its texts, publisher and counts, its current version's whole package for the preview with each
 * file's id, its versions and their notes, the listing it is based on when that is shown, and which version the
 * member got, if any. Never the publisher's own `source`.
 */
export async function listingPage(db: Db, listing: Listing, userId: string) {
	const [[publisher], versions, [got], [basedOn], [starred]] = await Promise.all([
		db.select({ username: tables.user.username, name: tables.user.name, avatarUrl: tables.user.avatarUrl }).from(tables.user).where(eq(tables.user.id, listing.ownerId)),
		db.select({ id: tables.listingVersion.id, number: tables.listingVersion.number, notes: tables.listingVersion.notes, size: tables.listingVersion.size, createdAt: tables.listingVersion.createdAt })
			.from(tables.listingVersion).where(eq(tables.listingVersion.listingId, listing.id)).orderBy(desc(tables.listingVersion.number)),
		db.select({ number: tables.listingVersion.number }).from(tables.acquisition)
			.leftJoin(tables.listingVersion, eq(tables.listingVersion.id, tables.acquisition.versionId))
			.where(and(eq(tables.acquisition.userId, userId), eq(tables.acquisition.listingId, listing.id)))
			.orderBy(desc(tables.acquisition.createdAt)).limit(1),
		listing.basedOnId
			? db.select({ id: tables.listing.id, name: tables.listing.name }).from(tables.listing).innerJoin(tables.user, eq(tables.user.id, tables.listing.ownerId)).where(and(eq(tables.listing.id, listing.basedOnId), shown))
			: [],
		db.select({ listingId: tables.star.listingId }).from(tables.star).where(and(eq(tables.star.userId, userId), eq(tables.star.listingId, listing.id))),
	])
	const [current] = listing.currentVersionId ? await db.select().from(tables.listingVersion).where(eq(tables.listingVersion.id, listing.currentVersionId)) : []
	const files = current ? await versionFiles(db, current.id) : {}
	const { source: _source, ...visible } = listing
	return {
		listing: visible,
		publisher: publisher!,
		version: current && { number: current.number, createdAt: current.createdAt, content: current.content },
		fileIds: Object.fromEntries(Object.entries(files).map(([key, file]) => [key, file.id])),
		versions: versions.map(({ id: _id, ...version }) => version),
		basedOn: basedOn ?? null,
		/** The version number the member got last; `null` when they never got it (a version since deleted reads 0). */
		got: got ? got.number ?? 0 : null,
		starred: !!starred,
	}
}

/**
 * "Get": the member's own copies of the listing's current version, from the files that version owns; a pack's setup
 * becomes a folder named after the listing. Recorded as an acquisition; a member's first get of someone else's
 * listing counts once.
 */
export async function getListing(db: Db, store: Store, listing: Listing, userId: string) {
	if (!listing.currentVersionId) throw new Error('A listing without a version')
	const [version] = await db.select().from(tables.listingVersion).where(eq(tables.listingVersion.id, listing.currentVersionId))
	const files = await versionFiles(db, version!.id)
	const made = await givePackage(db, store, {
		userId,
		content: version!.content,
		paths: Object.fromEntries(Object.entries(files).map(([key, file]) => [key, file.blobPath])),
		folderName: listing.name,
	})
	await db.transaction(async (tx) => {
		const [before] = await tx.select({ count: count() }).from(tables.acquisition).where(and(eq(tables.acquisition.userId, userId), eq(tables.acquisition.listingId, listing.id)))
		await tx.insert(tables.acquisition).values({ userId, listingId: listing.id, versionId: version!.id, created: made })
		if (!before?.count && userId !== listing.ownerId) await tx.update(tables.listing).set({ gets: sql`${tables.listing.gets} + 1` }).where(eq(tables.listing.id, listing.id))
	})
	return { ...made, version: version!.number }
}

/**
 * Every listing, whatever its status, for admins and moderators: featured first, then newest, with its publisher and
 * current version.
 */
// ponytail: one list, not paged; page it when an instance has thousands of listings.
export async function allListings(db: Db) {
	return await db.select({
		id: tables.listing.id,
		kind: tables.listing.kind,
		name: tables.listing.name,
		status: tables.listing.status,
		statusReason: tables.listing.statusReason,
		featured: tables.listing.featured,
		gets: tables.listing.gets,
		publishedAt: tables.listing.publishedAt,
		version: tables.listingVersion.number,
		publisher: { username: tables.user.username, name: tables.user.name, avatarUrl: tables.user.avatarUrl },
	}).from(tables.listing)
		.innerJoin(tables.user, eq(tables.user.id, tables.listing.ownerId))
		.leftJoin(tables.listingVersion, eq(tables.listingVersion.id, tables.listing.currentVersionId))
		.orderBy(desc(tables.listing.featured), desc(tables.listing.publishedAt))
}
