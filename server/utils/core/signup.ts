import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { z } from 'zod'
// Relative, not `hub:db`, so this module also loads in `bun test`.
import * as tables from '../../db/schema'

type Db = PgDatabase<PgQueryResultHKT, typeof tables>
type DbUser = typeof tables.user.$inferSelect

export type SignupMode = 'invite' | 'open' | 'closed'
export type SignInError = 'signup_closed' | 'invite_required' | 'invite_invalid'
export type SignInResult = { user: DbUser } | { error: SignInError }

/** The parts of a GitHub user that nuxt-auth-utils hands to `onSuccess`. */
export interface GitHubProfile {
	id: number
	login: string
	name?: string | null
	email?: string | null
	avatar_url?: string | null
}

const { invite, setting, user } = tables

// Any constant works; it only has to be the same in every process that signs people up.
const SIGNUP_LOCK = 72_154_610

const signupModeSchema = z.enum(['invite', 'open', 'closed']).catch('invite')

/** A new invite code. Only its hash is stored; the code itself is shown once. */
export function newInviteCode(): string {
	return randomBytes(24).toString('base64url')
}

export function hashInviteCode(code: string): string {
	return createHash('sha256').update(code).digest('hex')
}

function usableInvite(code: string) {
	return and(
		eq(invite.codeHash, hashInviteCode(code)),
		isNull(invite.revokedAt),
		lt(invite.useCount, invite.maxUses),
		or(isNull(invite.expiresAt), gt(invite.expiresAt, sql`now()`)),
	)
}

export async function isInviteUsable(db: Db, code: string): Promise<boolean> {
	const [row] = await db.select({ id: invite.id }).from(invite).where(usableInvite(code)).limit(1)
	return !!row
}

/** Defaults to `invite` when unset or invalid. */
export async function getSignupMode(db: Db): Promise<SignupMode> {
	const [row] = await db.select({ value: setting.value }).from(setting).where(eq(setting.key, 'signupMode')).limit(1)
	return signupModeSchema.parse(row?.value)
}

/**
 * Signs a GitHub account in, creating the account if the signup rules allow it.
 *
 * - A known account signs in and its profile is refreshed from GitHub.
 * - The very first account is created as admin, whatever the signup mode.
 * - After that, `open` lets anyone in, `invite` needs an invite that can still be claimed, `closed` lets nobody in.
 *
 * Ban state is not checked here.
 */
export async function signInWithGitHub(db: Db, profile: GitHubProfile, inviteCode?: string): Promise<SignInResult> {
	const profileFields = {
		username: profile.login,
		name: profile.name || null,
		email: profile.email || null,
		avatarUrl: profile.avatar_url || null,
	}

	const [existing] = await db.update(user).set(profileFields).where(eq(user.githubId, profile.id)).returning()
	if (existing) return { user: existing }

	return await db.transaction(async (tx) => {
		// Serializes signups, so two simultaneous first signups cannot both become admin.
		await tx.execute(sql`select pg_advisory_xact_lock(${SIGNUP_LOCK})`)

		// The same account may have signed up while this request waited for the lock.
		const [created] = await tx.select().from(user).where(eq(user.githubId, profile.id))
		if (created) return { user: created }

		const [anyone] = await tx.select({ id: user.id }).from(user).limit(1)
		if (anyone) {
			const mode = await getSignupMode(tx)
			if (mode === 'closed') return { error: 'signup_closed' as const }
			if (mode === 'invite') {
				if (!inviteCode) return { error: 'invite_required' as const }
				const [claimed] = await tx.update(invite)
					.set({ useCount: sql`${invite.useCount} + 1` })
					.where(usableInvite(inviteCode))
					.returning({ id: invite.id })
				if (!claimed) return { error: 'invite_invalid' as const }
			}
		}

		const [inserted] = await tx.insert(user)
			.values({ githubId: profile.id, ...profileFields, role: anyone ? 'user' : 'admin' })
			.returning()
		return { user: inserted! }
	})
}
