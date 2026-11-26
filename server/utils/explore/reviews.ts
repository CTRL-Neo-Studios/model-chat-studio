import { createError } from 'nuxt/server'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
// Relative, not `hub:db`, so this module also loads in `bun test`.
import * as tables from '../../db/schema'
import type { Db } from '../core/settings'
import { findListing } from './listings'

/** A version's listing, for reviewing it; ids that are not UUIDs find nothing. */
export async function findVersionListing(db: Db, versionId: string | undefined) {
	const [version] = z.uuid().safeParse(versionId).success
		? await db.select({ listingId: tables.listingVersion.listingId }).from(tables.listingVersion).where(eq(tables.listingVersion.id, versionId!))
		: []
	return version ? await findListing(db, version.listingId) : undefined
}

/**
 * What waits for review, oldest first: each version with its listing, publisher and note, whether it updates a
 * listing already on Explore, and the reason an earlier submission of it was rejected, if one was.
 */
export async function pendingReviews(db: Db) {
	const rows = await db.select({
		versionId: tables.listingVersion.id,
		number: tables.listingVersion.number,
		notes: tables.listingVersion.notes,
		createdAt: tables.listingVersion.createdAt,
		listingId: tables.listing.id,
		name: tables.listing.name,
		kind: tables.listing.kind,
		ownerId: tables.listing.ownerId,
		update: tables.listing.currentVersionId,
		publisher: { username: tables.user.username, name: tables.user.name },
	}).from(tables.listingVersion)
		.innerJoin(tables.listing, eq(tables.listing.id, tables.listingVersion.listingId))
		.innerJoin(tables.user, eq(tables.user.id, tables.listing.ownerId))
		.where(eq(tables.listingVersion.status, 'pending'))
		.orderBy(asc(tables.listingVersion.createdAt))
	const rejected = rows.length
		? await db.select({ listingId: tables.listingVersion.listingId, number: tables.listingVersion.number, reason: tables.listingVersion.reason }).from(tables.listingVersion).where(eq(tables.listingVersion.status, 'rejected'))
		: []
	return rows.map(({ update, ...row }) => ({
		...row,
		update: update !== null,
		rejectedBefore: rejected.filter(version => version.listingId === row.listingId && version.number < row.number).toSorted((a, b) => b.number - a.number)[0]?.reason ?? null,
	}))
}

export type ReviewDecision = { approve: true } | { reject: true, reason: string }

/**
 * Approves or rejects a version waiting for review. Approving puts it on Explore as the listing's current version (a
 * listing's first approval also dates its publication); rejecting, with the reason its publisher reads, leaves Explore
 * as it was. A version not waiting is refused.
 */
export async function reviewVersion(db: Db, input: { versionId: string, reviewerId: string, decision: ReviewDecision }) {
	await db.transaction(async (tx) => {
		const [version] = await tx.update(tables.listingVersion)
			.set('approve' in input.decision
				? { status: 'approved', reason: null, reviewedBy: input.reviewerId, reviewedAt: new Date() }
				: { status: 'rejected', reason: input.decision.reason, reviewedBy: input.reviewerId, reviewedAt: new Date() })
			.where(and(eq(tables.listingVersion.id, input.versionId), eq(tables.listingVersion.status, 'pending')))
			.returning()
		if (!version) throw createError({ status: 409, statusText: 'This publication is not waiting for review' })
		if (version.status !== 'approved') return
		const [listing] = await tx.select({ currentVersionId: tables.listing.currentVersionId }).from(tables.listing).where(eq(tables.listing.id, version.listingId))
		await tx.update(tables.listing).set({
			currentVersionId: version.id,
			updatedAt: new Date(),
			...(listing!.currentVersionId === null && { publishedAt: new Date() }),
		}).where(eq(tables.listing.id, version.listingId))
	})
}
