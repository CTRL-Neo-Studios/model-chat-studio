import { expect, test } from 'bun:test'
import { allows } from 'nuxt-authorization/utils'
import { userAbilities } from '../shared/abilities/userAbilities'
import type { User, UserRole } from '../shared/types/db'

const make = (id: string, role: UserRole, ban: Partial<User> = {}) => ({ id, role, banned: false, banExpires: null, ...ban }) as User

const admin = make('a1', 'admin')
const admin2 = make('a2', 'admin')
const mod = make('m1', 'moderator')
const mod2 = make('m2', 'moderator')
const member = make('u1', 'user')
const can = userAbilities()

test('a moderator cannot ban, unban or demote an admin, or act on another moderator', async () => {
	expect(await allows(can.banUser, mod, admin)).toBe(false)
	expect(await allows(can.unbanUser, mod, admin)).toBe(false)
	expect(await allows(can.demoteUser, mod, admin)).toBe(false)
	expect(await allows(can.banUser, mod, mod2)).toBe(false)
})

test('a moderator can ban and unban a member, nothing more', async () => {
	expect(await allows(can.banUser, mod, member)).toBe(true)
	expect(await allows(can.unbanUser, mod, member)).toBe(true)
	expect(await allows(can.promoteUser, mod, member)).toBe(false)
	expect(await allows(can.deleteUser, mod, member)).toBe(false)
	expect(await allows(can.listUsers, mod)).toBe(true)
	expect(await allows(can.listUsers, member)).toBe(false)
})

test('role actions never apply to oneself or to another admin', async () => {
	expect(await allows(can.banUser, admin, admin)).toBe(false)
	expect(await allows(can.deleteUser, admin, admin)).toBe(false)
	expect(await allows(can.deleteUser, admin, admin2)).toBe(false)
	expect(await allows(can.demoteUser, admin, admin2)).toBe(false)
	expect(await allows(can.editUser, admin, admin, 'user')).toBe(false)
})

test('an admin promotes members, demotes moderators, and edits budgets of anyone', async () => {
	expect(await allows(can.promoteUser, admin, member)).toBe(true)
	expect(await allows(can.promoteUser, admin, mod)).toBe(false)
	expect(await allows(can.demoteUser, admin, mod)).toBe(true)
	expect(await allows(can.demoteUser, admin, member)).toBe(false)
	expect(await allows(can.editUser, admin, admin)).toBe(true)
	expect(await allows(can.editUser, admin, member, 'admin')).toBe(true)
	expect(await allows(can.editUser, mod, member)).toBe(false)
})

test('a ban stops applying once it expires', async () => {
	const banned = make('b1', 'moderator', { banned: true, banExpires: new Date(Date.now() + 60_000) })
	const expired = make('b2', 'moderator', { banned: true, banExpires: new Date(Date.now() - 60_000) })
	expect(await allows(can.banUser, banned, member)).toBe(false)
	expect(await allows(can.banUser, expired, member)).toBe(true)
})
