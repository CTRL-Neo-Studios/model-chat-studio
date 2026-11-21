import { expect, test } from 'bun:test'
import * as schema from '../server/db/schema'
import { profileAbilities, type ProfileAccess } from '../shared/abilities/profileAbilities'
import { authorize } from '../server/utils/core/authorize'
import { setSetting } from '../server/utils/core/settings'
import { newLaneValues } from '../server/utils/chat/lanes'
import { listModelProfiles } from '../server/utils/chat/profiles'
import { createTestDb } from './db'

type TestUser = { id: string, role: 'user' | 'moderator' | 'admin', banned: boolean, banExpires: Date | null }
const person = (id: string, role: TestUser['role'] = 'user'): TestUser => ({ id, role, banned: false, banExpires: null })
const eventFor = (user: TestUser) => ({ context: { $authorization: { resolveServerUser: async () => user } } }) as never
const check = (ability: 'readProfile' | 'manageProfile', user: TestUser, profile: ProfileAccess) =>
	authorize(eventFor(user), profileAbilities()[ability] as never, profile as never)

test('a member uses their own and the instance profiles; only admins change instance profiles; others\' are not found', async () => {
	const own: ProfileAccess = { ownerId: 'member' }
	const instance: ProfileAccess = { ownerId: null }
	const member = person('member')
	const admin = person('admin', 'admin')

	await check('readProfile', member, own)
	await check('readProfile', member, instance)
	await check('manageProfile', member, own)
	await expect(check('manageProfile', member, instance)).rejects.toMatchObject({ status: 403 })
	await check('manageProfile', admin, instance)
	// Admins get no access to members' personal profiles either.
	for (const ability of ['readProfile', 'manageProfile'] as const) {
		await expect(check(ability, admin, own)).rejects.toMatchObject({ status: 404 })
	}
})

test('a lane started from a profile copies it, with the given fields on top; another member\'s profile is refused', async () => {
	const db = await createTestDb()
	const [a, b] = await db.insert(schema.user).values([{ githubId: 1, username: 'a' }, { githubId: 2, username: 'b' }]).returning()
	await setSetting(db, 'inferencePlatform', 'openrouter')
	const [mine, published, theirs] = await db.insert(schema.modelProfile).values([
		{ ownerId: a!.id, name: 'Mine', color: 'violet', platform: 'openrouter', modelId: 'x/one', systemPrompt: 'Be brief.', params: { temperature: 0.3 } },
		{ ownerId: null, name: 'Published', platform: 'openrouter', modelId: 'x/two' },
		{ ownerId: b!.id, name: 'Theirs', platform: 'openrouter', modelId: 'x/three' },
	]).returning()

	expect(await newLaneValues(db, a!.id, { profileId: mine!.id })).toEqual({
		profileId: mine!.id, name: 'Mine', color: 'violet', platform: 'openrouter', modelId: 'x/one', systemPrompt: 'Be brief.', params: { temperature: 0.3 },
	})
	expect(await newLaneValues(db, a!.id, { profileId: published!.id, systemPrompt: '', params: { topK: 5 } })).toMatchObject({
		profileId: published!.id, modelId: 'x/two', systemPrompt: null, params: { topK: 5 },
	})
	await expect(newLaneValues(db, a!.id, { profileId: theirs!.id })).rejects.toMatchObject({ status: 404 })

	// Own first, then instance profiles; never someone else's.
	expect((await listModelProfiles(db, a!.id)).map(profile => profile.name)).toEqual(['Mine', 'Published'])
})
