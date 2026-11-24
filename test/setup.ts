// `bun test` runs outside Nuxt. This file stands in for what Nuxt would provide.
import { createHash } from 'node:crypto'
import { mock } from 'bun:test'

// Nuxt aliases `#nuxt-cs-utils` to the module's runtime, which Node reaches as `/runtime`.
mock.module('#nuxt-cs-utils', () => import('@type32/nuxt-cs-utils/runtime'))

// `nuxt/server` only loads inside a Nuxt server build.
mock.module('nuxt/server', () => ({
	createError: ({ status, statusText }: { status: number, statusText: string }) =>
		Object.assign(new Error(statusText), { status }),
	// Same shape as the real one: 32 bytes as hex, stable per purpose.
	deriveSecret: async (purpose: string) => createHash('sha256').update(`test-app-secret:${purpose}`).digest('hex'),
}))
