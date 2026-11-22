import { expect, test } from 'bun:test'
import { allows } from 'nuxt-authorization/utils'
import { projectAbilities } from '../shared/abilities/projectAbilities'
import type { User } from '../shared/types/db'

const person = (id: string) => ({ id, role: 'user', banned: false, banExpires: null }) as User
const project = { ownerId: 'owner', members: { editor: 'editor', member: 'member', viewer: 'viewer' } as const }
const can = projectAbilities()

// The access table of the plan (milestones 2–4, section 5), row by row.
test('each role can do what the access table says, and no more', async () => {
	const rows = { readProject: can.readProject, startChats: can.startChats, editFiles: can.editFiles, manageProject: can.manageProject }
	const table = {
		owner: [true, true, true, true],
		editor: [true, true, true, false],
		member: [true, true, false, false],
		viewer: [true, false, false, false],
		stranger: [false, false, false, false],
	}
	for (const [who, expected] of Object.entries(table)) {
		const got = await Promise.all(Object.values(rows).map(ability => allows(ability, person(who), project)))
		expect({ who, got }).toEqual({ who, got: expected })
	}
})
