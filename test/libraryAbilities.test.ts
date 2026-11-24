import { expect, test } from 'bun:test'
import { allows } from 'nuxt-authorization/utils'
import { libraryAbilities } from '../shared/abilities/libraryAbilities'
import type { User } from '../shared/types/db'

const person = (id: string) => ({ id, role: 'user', banned: false, banExpires: null }) as User
const library = { ownerId: 'owner', members: { editor: 'editor', viewer: 'viewer' } as const }
const can = libraryAbilities()

// The access table of the plan (milestones 5–6, section 3), row by row.
test('each role can do what the access table says, and no more', async () => {
	const rows = { readLibrary: can.readLibrary, editFiles: can.editFiles, manageLibrary: can.manageLibrary }
	const table = {
		owner: [true, true, true],
		editor: [true, true, false],
		viewer: [true, false, false],
		stranger: [false, false, false],
	}
	for (const [who, expected] of Object.entries(table)) {
		const got = await Promise.all(Object.values(rows).map(ability => allows(ability, person(who), library)))
		expect({ who, got }).toEqual({ who, got: expected })
	}
})
