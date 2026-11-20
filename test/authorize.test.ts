import { expect, mock, test } from 'bun:test'
import { defineAbility, deny } from 'nuxt-authorization/utils'

// `nuxt/server` only loads inside a Nuxt server build; the wrapper needs nothing from it but `createError`.
mock.module('nuxt/server', () => ({
	createError: ({ status, statusText }: { status: number, statusText: string }) =>
		Object.assign(new Error(statusText), { status }),
}))

// Dynamic: a static import is hoisted above `mock.module` and would load the real `nuxt/server`.
const { authorize } = await import('../server/utils/core/authorize')

type TestUser = { id: string }

function eventFor(resolveServerUser: () => Promise<TestUser | null | undefined>) {
	return { context: { $authorization: { resolveServerUser } } } as never
}

const member = { id: 'u1' }
const membersOnly = defineAbility((user: TestUser) => !!user.id)
const throwing = defineAbility((user: TestUser): boolean => {
	throw new Error(`lookup failed for ${user.id}`)
})
const hiddenFromStrangers = defineAbility({ allowGuest: true }, (user: TestUser | null) =>
	user ? true : deny({ statusCode: 404, message: 'Chat not found' }))

test('lets an allowed user through', async () => {
	await authorize(eventFor(async () => member), membersOnly as never)
})

test('treats an undefined user as a guest', async () => {
	// The module's own server authorize only treats `null` as a guest and lets this through.
	await expect(authorize(eventFor(async () => undefined), membersOnly as never)).rejects.toMatchObject({ status: 403 })
})

test('rethrows an ability error instead of allowing', async () => {
	await expect(authorize(eventFor(async () => member), throwing as never)).rejects.toThrow('lookup failed for u1')
})

test('rethrows a user lookup error instead of allowing', async () => {
	await expect(authorize(eventFor(async () => { throw new Error('db down') }), membersOnly as never)).rejects.toThrow('db down')
})

test('keeps the status an ability denies with', async () => {
	await expect(authorize(eventFor(async () => null), hiddenFromStrangers as never)).rejects.toMatchObject({ status: 404, message: 'Chat not found' })
})
