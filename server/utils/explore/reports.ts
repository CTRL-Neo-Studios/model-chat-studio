import { createError } from 'nuxt/server'
import { and, asc, eq, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
// Relative, not `hub:db`, so this module also loads in `bun test`.
import * as tables from '../../db/schema'
import type { Db } from '../core/settings'

export const reportReasonSchema = z.string().trim().min(1).max(500)

/** A member's report of a listing they can see, with a reason; once while it is open, and never of their own. */
export async function reportListing(db: Db, input: { userId: string, listing: { id: string, ownerId: string }, reason: string }) {
	if (input.listing.ownerId === input.userId) throw createError({ status: 400, statusText: 'This listing is yours: change it or delete it instead' })
	const [report] = await db.insert(tables.listingReport).values({ listingId: input.listing.id, userId: input.userId, reason: input.reason }).onConflictDoNothing().returning()
	if (!report) throw createError({ status: 409, statusText: 'You reported this listing already; an admin or moderator will look at it' })
	return report
}

/** Open reports, oldest first, each with its listing (name, kind, status, publisher) and who reported it. */
export async function openReports(db: Db) {
	const publisher = sql<string>`(select coalesce(${tables.user.name}, ${tables.user.username}) from ${tables.user} where ${tables.user.id} = ${tables.listing.ownerId})`
	return await db.select({
		id: tables.listingReport.id,
		reason: tables.listingReport.reason,
		createdAt: tables.listingReport.createdAt,
		listingId: tables.listing.id,
		name: tables.listing.name,
		kind: tables.listing.kind,
		status: tables.listing.status,
		ownerId: tables.listing.ownerId,
		publisher,
		reporter: { username: tables.user.username, name: tables.user.name },
	}).from(tables.listingReport)
		.innerJoin(tables.listing, eq(tables.listing.id, tables.listingReport.listingId))
		.innerJoin(tables.user, eq(tables.user.id, tables.listingReport.userId))
		.where(eq(tables.listingReport.status, 'open'))
		.orderBy(asc(tables.listingReport.createdAt))
}

export type ReportDecision = { dismiss: true } | { remove: true, reason: string }

/**
 * A decision on an open report: dismissed, the listing left as it is; or the listing removed with the reason its
 * publisher sees (as in milestone 13), which settles every open report of it as acted on. A report already settled
 * is refused.
 */
export async function resolveReport(db: Db, input: { reportId: string, resolverId: string, decision: ReportDecision }) {
	await db.transaction(async (tx) => {
		const [report] = await tx.select().from(tables.listingReport).where(and(eq(tables.listingReport.id, input.reportId), eq(tables.listingReport.status, 'open')))
		if (!report) throw createError({ status: 409, statusText: 'This report is settled already' })
		if ('dismiss' in input.decision) {
			await tx.update(tables.listingReport).set({ status: 'dismissed', resolvedBy: input.resolverId }).where(eq(tables.listingReport.id, report.id))
			return
		}
		await tx.update(tables.listing).set({ status: 'removed', statusReason: input.decision.reason, updatedAt: new Date() }).where(eq(tables.listing.id, report.listingId))
		await tx.update(tables.listingReport).set({ status: 'acted', resolvedBy: input.resolverId })
			.where(and(eq(tables.listingReport.listingId, report.listingId), eq(tables.listingReport.status, 'open')))
	})
}

/** A report's listing, for the decision on it; ids that are not UUIDs find nothing. */
export async function findReport(db: Db, id: string | undefined) {
	if (!z.uuid().safeParse(id).success) return undefined
	const [report] = await db.select().from(tables.listingReport).where(eq(tables.listingReport.id, id!))
	return report
}

/**
 * The counts beside "Explore": `attention`, the member's listings that were rejected (their newest version) or
 * removed; `waiting`, for admins and moderators, what they could review (others' versions waiting) and open reports.
 */
export async function exploreCounts(db: Db, viewer: { id: string, staff: boolean }) {
	const newest = sql`(select ${tables.listingVersion.status} from ${tables.listingVersion} where ${tables.listingVersion.listingId} = ${tables.listing.id} order by ${tables.listingVersion.number} desc limit 1)`
	const [attention] = await db.select({ count: sql<number>`count(*)::int` }).from(tables.listing)
		.where(and(eq(tables.listing.ownerId, viewer.id), sql`(${tables.listing.status} = 'removed' or ${newest} = 'rejected')`))
	if (!viewer.staff) return { attention: attention?.count ?? 0, waiting: 0 }
	const [pending, reports] = await Promise.all([
		db.select({ count: sql<number>`count(*)::int` }).from(tables.listingVersion)
			.innerJoin(tables.listing, eq(tables.listing.id, tables.listingVersion.listingId))
			.where(and(eq(tables.listingVersion.status, 'pending'), ne(tables.listing.ownerId, viewer.id))),
		db.select({ count: sql<number>`count(*)::int` }).from(tables.listingReport).where(eq(tables.listingReport.status, 'open')),
	])
	return { attention: attention?.count ?? 0, waiting: (pending[0]?.count ?? 0) + (reports[0]?.count ?? 0) }
}
