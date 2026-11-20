import { beforeEach, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import * as schema from '../server/db/schema'
import { hashInviteCode, signInWithGitHub, type GitHubProfile, type SignInResult } from '../server/utils/core/signup'
import { createTestDb, type TestDb } from './db'

let db: TestDb

beforeEach(async () => {
	db = await createTestDb()
})

const github = (id: number): GitHubProfile => ({ id, login: `user${id}`, name: `User ${id}`, avatar_url: `https://avatars.example/${id}` })

async function setSignupMode(mode: string) {
	await db.insert(schema.setting).values({ key: 'signupMode', value: mode })
		.onConflictDoUpdate({ target: schema.setting.key, set: { value: mode } })
}

async function addInvite(code: string, fields: Partial<typeof schema.invite.$inferInsert> = {}) {
	await db.insert(schema.invite).values({ codeHash: hashInviteCode(code), ...fields })
}

function roleOf(result: SignInResult) {
	return 'user' in result ? result.user.role : result.error
}

test('the first signup becomes admin, even without an invite', async () => {
	expect(roleOf(await signInWithGitHub(db, github(1)))).toBe('admin')
})

test('later signups need an invite by default', async () => {
	await signInWithGitHub(db, github(1))
	expect(roleOf(await signInWithGitHub(db, github(2)))).toBe('invite_required')
})

test('an invite admits one person as a normal user, and a second use is refused', async () => {
	await signInWithGitHub(db, github(1))
	await addInvite('code-a')

	expect(roleOf(await signInWithGitHub(db, github(2), 'code-a'))).toBe('user')
	expect(roleOf(await signInWithGitHub(db, github(3), 'code-a'))).toBe('invite_invalid')

	const [row] = await db.select().from(schema.invite)
	expect(row!.useCount).toBe(1)
})

test('a multi-use invite admits up to its limit', async () => {
	await signInWithGitHub(db, github(1))
	await addInvite('code-b', { maxUses: 2 })

	expect(roleOf(await signInWithGitHub(db, github(2), 'code-b'))).toBe('user')
	expect(roleOf(await signInWithGitHub(db, github(3), 'code-b'))).toBe('user')
	expect(roleOf(await signInWithGitHub(db, github(4), 'code-b'))).toBe('invite_invalid')
})

test('expired, revoked and unknown invites are refused', async () => {
	await signInWithGitHub(db, github(1))
	await addInvite('expired', { expiresAt: new Date(Date.now() - 1000) })
	await addInvite('revoked', { revokedAt: new Date() })

	expect(roleOf(await signInWithGitHub(db, github(2), 'expired'))).toBe('invite_invalid')
	expect(roleOf(await signInWithGitHub(db, github(2), 'revoked'))).toBe('invite_invalid')
	expect(roleOf(await signInWithGitHub(db, github(2), 'unknown'))).toBe('invite_invalid')
})

test('open signup needs no invite; closed signup refuses even a valid invite', async () => {
	await signInWithGitHub(db, github(1))
	await addInvite('code-c')

	await setSignupMode('open')
	expect(roleOf(await signInWithGitHub(db, github(2)))).toBe('user')

	await setSignupMode('closed')
	expect(roleOf(await signInWithGitHub(db, github(3), 'code-c'))).toBe('signup_closed')
	const [row] = await db.select().from(schema.invite)
	expect(row!.useCount).toBe(0)
})

test('a returning member signs in without an invite and keeps their role; the profile is refreshed', async () => {
	await signInWithGitHub(db, github(1))
	await addInvite('code-d')
	await signInWithGitHub(db, github(2), 'code-d')

	const again = await signInWithGitHub(db, { ...github(2), login: 'renamed' })
	expect('user' in again && again.user.username).toBe('renamed')
	expect(roleOf(again)).toBe('user')

	const admins = await db.select().from(schema.user).where(eq(schema.user.role, 'admin'))
	expect(admins).toHaveLength(1)
})
