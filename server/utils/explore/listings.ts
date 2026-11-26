import { randomUUID } from 'node:crypto'
import { createError } from 'nuxt/server'
import { desc, eq, inArray, max } from 'drizzle-orm'
import { z } from 'zod'
// Relative, not `#shared` or `hub:db`, so this module also loads in `bun test`.
import * as tables from '../../db/schema'
import type { Db } from '../core/settings'
import { type ExploreSettings, listingKind, type listingTextsSchema, type Package, type PackageSource, packageSize } from '../../../shared/utils/package'
import { copyFiles, fileExtension, removeFiles, type Store, takePackage } from './package'

export type ListingTexts = z.output<typeof listingTextsSchema>
export type Listing = typeof tables.listing.$inferSelect

/**
 * One listing, whoever it belongs to, with `ownerBanned` (its publisher is banned while the ban lasts, which hides it);
 * access is checked with `exploreAbilities`. Ids that are not UUIDs find nothing.
 */
export async function findListing(db: Db, id: string | undefined) {
	if (!z.uuid().safeParse(id).success) return undefined
	const [row] = await db.select({ listing: tables.listing, banned: tables.user.banned, banExpires: tables.user.banExpires }).from(tables.listing)
		.innerJoin(tables.user, eq(tables.user.id, tables.listing.ownerId))
		.where(eq(tables.listing.id, id!))
	return row && { ...row.listing, ownerBanned: row.banned && (!row.banExpires || row.banExpires > new Date()) }
}

/** The listing one of whose versions owns this file, if any. */
export async function findFileListing(db: Db, fileId: string) {
	const [row] = await db.select({ listingId: tables.listingVersion.listingId }).from(tables.listingFile)
		.innerJoin(tables.listingVersion, eq(tables.listingVersion.id, tables.listingFile.versionId))
		.where(eq(tables.listingFile.fileId, fileId))
	return row ? await findListing(db, row.listingId) : undefined
}

/** A listing's category must be one the instance keeps. */
function assertCategory(settings: ExploreSettings, category: string | null | undefined) {
	if (category && !settings.categories.includes(category)) throw createError({ status: 400, statusText: `“${category}” is not one of Explore's categories` })
}

/** The package of a source, within the instance's size limit. */
async function take(db: Db, userId: string, source: PackageSource, settings: ExploreSettings) {
	const taken = await takePackage(db, userId, source)
	if (packageSize(taken.content) > settings.maxSizeMb * 1024 * 1024) throw createError({ status: 413, statusText: `A listing can be at most ${settings.maxSizeMb} MB with its files` })
	return taken
}

/** What publishing a source would hold, and what it would leave out: for the dialog, before publishing. */
export async function previewListing(db: Db, userId: string, source: PackageSource, settings: ExploreSettings) {
	const { content, left } = await take(db, userId, source, settings)
	return {
		kind: listingKind(source),
		characters: content.characters.map(character => character.name),
		libraries: content.libraries.map(library => ({ name: library.name, entries: library.entries.length })),
		structureProfiles: content.structureProfiles.map(profile => profile.name),
		setup: content.setup && { lanes: content.setup.models?.length ?? 0, mode: content.setup.mode ?? 'separate' },
		files: content.files.length,
		size: packageSize(content),
		left,
	}
}

/** The listing a source was got from, when one of its items is a copy the member got from Explore. */
async function basedOn(db: Db, userId: string, source: PackageSource) {
	const ids = [...source.characterIds ?? [], ...source.libraryIds ?? [], ...source.structureProfileIds ?? [], ...source.folderId ? [source.folderId] : []]
	if (!ids.length) return null
	const got = await db.select({ listingId: tables.acquisition.listingId, created: tables.acquisition.created }).from(tables.acquisition)
		.where(eq(tables.acquisition.userId, userId)).orderBy(desc(tables.acquisition.createdAt))
	return got.find(({ created }) => [...created.characterIds, ...created.libraryIds, ...created.structureProfileIds, created.folderId].some(id => id && ids.includes(id)))?.listingId ?? null
}

/**
 * Stores a version of a listing: the package's files copied into storage the version owns (`explore/<version>/<key>`),
 * four at a time, then, in one transaction, `first` (the listing's row, on publishing), the version numbered after the
 * last, its files, and the listing pointing at it. If the transaction fails, the copies are removed.
 */
async function addVersion(db: Db, store: Store, input: { listingId: string, ownerId: string, notes: string, content: Package, paths: Record<string, string>, first?: (tx: Db) => Promise<unknown> }) {
	const versionId = randomUUID()
	const files = input.content.files.map(file => ({ ...file, id: randomUUID(), from: input.paths[file.key]!, blobPath: `explore/${versionId}/${file.key}${fileExtension(input.paths[file.key] ?? '')}` }))
	const copied = await copyFiles(store, files.map(file => ({ from: file.from, to: file.blobPath, mediaType: file.mediaType })))
	try {
		await db.transaction(async (tx) => {
			await input.first?.(tx)
			const [last] = await tx.select({ number: max(tables.listingVersion.number) }).from(tables.listingVersion).where(eq(tables.listingVersion.listingId, input.listingId))
			await tx.insert(tables.listingVersion).values({ id: versionId, listingId: input.listingId, number: (last?.number ?? 0) + 1, notes: input.notes, content: input.content, size: packageSize(input.content) })
			if (files.length) {
				await tx.insert(tables.file).values(files.map(file => ({ id: file.id, ownerId: input.ownerId, chatId: null, blobPath: file.blobPath, fileName: file.name, mediaType: file.mediaType, size: file.size })))
				await tx.insert(tables.listingFile).values(files.map(file => ({ versionId, key: file.key, fileId: file.id })))
			}
			await tx.update(tables.listing).set({ currentVersionId: versionId, updatedAt: new Date() }).where(eq(tables.listing.id, input.listingId))
		})
	}
	catch (error) {
		await removeFiles(store, copied)
		throw error
	}
}

/** Publishes the member's items as a new listing, version 1. Returns the listing and what was left out. */
export async function publishListing(db: Db, store: Store, input: { userId: string, texts: ListingTexts, source: PackageSource, settings: ExploreSettings }) {
	assertCategory(input.settings, input.texts.category)
	const { content, paths, left } = await take(db, input.userId, input.source, input.settings)
	const listingId = randomUUID()
	const basedOnId = await basedOn(db, input.userId, input.source)
	await addVersion(db, store, {
		listingId,
		ownerId: input.userId,
		notes: '',
		content,
		paths,
		first: tx => tx.insert(tables.listing).values({ id: listingId, ownerId: input.userId, kind: listingKind(input.source), ...input.texts, source: input.source, basedOnId }),
	})
	return { listing: (await findListing(db, listingId))!, left }
}

/**
 * "Publish an update": a new version from the listing's source (or a new one, of the same kind), with a note on what
 * changed. Copies made of earlier versions stay as they are.
 */
export async function publishUpdate(db: Db, store: Store, input: { listing: Listing, notes: string, source?: PackageSource, settings: ExploreSettings }) {
	const source = input.source ?? input.listing.source
	if (listingKind(source) !== input.listing.kind) throw createError({ status: 400, statusText: 'An update holds the same kind of content as the listing' })
	const { content, paths, left } = await take(db, input.listing.ownerId, source, input.settings)
	await addVersion(db, store, { listingId: input.listing.id, ownerId: input.listing.ownerId, notes: input.notes, content, paths })
	if (input.source) await db.update(tables.listing).set({ source }).where(eq(tables.listing.id, input.listing.id))
	return { listing: (await findListing(db, input.listing.id))!, left }
}

/** The publisher's changes (texts, listed or unlisted) and the moderators' (featured, removed with a reason, restored). */
export async function changeListing(db: Db, listing: Listing, patch: Partial<ListingTexts> & { status?: Listing['status'], statusReason?: string | null, featured?: boolean }, settings: ExploreSettings) {
	assertCategory(settings, patch.category)
	const [row] = await db.update(tables.listing).set({ ...patch, updatedAt: new Date() }).where(eq(tables.listing.id, listing.id)).returning()
	return row!
}

/** Deletes a listing with its versions and the files they own. Copies members got stay theirs. */
export async function deleteListing(db: Db, store: Store, listingId: string) {
	const owned = await db.select({ id: tables.file.id, blobPath: tables.file.blobPath }).from(tables.listingFile)
		.innerJoin(tables.listingVersion, eq(tables.listingVersion.id, tables.listingFile.versionId))
		.innerJoin(tables.file, eq(tables.file.id, tables.listingFile.fileId))
		.where(eq(tables.listingVersion.listingId, listingId))
	await db.transaction(async (tx) => {
		await tx.delete(tables.listing).where(eq(tables.listing.id, listingId))
		if (owned.length) await tx.delete(tables.file).where(inArray(tables.file.id, owned.map(file => file.id)))
	})
	await removeFiles(store, owned.map(file => file.blobPath))
}

/** The member's listings, whatever their status, newest first, with their current version's number. */
export async function myListings(db: Db, userId: string) {
	return await db.select({
		id: tables.listing.id,
		kind: tables.listing.kind,
		name: tables.listing.name,
		summary: tables.listing.summary,
		description: tables.listing.description,
		tags: tables.listing.tags,
		category: tables.listing.category,
		status: tables.listing.status,
		statusReason: tables.listing.statusReason,
		featured: tables.listing.featured,
		source: tables.listing.source,
		gets: tables.listing.gets,
		publishedAt: tables.listing.publishedAt,
		updatedAt: tables.listing.updatedAt,
		version: tables.listingVersion.number,
	}).from(tables.listing)
		.leftJoin(tables.listingVersion, eq(tables.listingVersion.id, tables.listing.currentVersionId))
		.where(eq(tables.listing.ownerId, userId))
		.orderBy(desc(tables.listing.publishedAt))
}

export type MyListing = Awaited<ReturnType<typeof myListings>>[number]
