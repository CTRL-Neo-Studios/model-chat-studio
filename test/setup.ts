// `bun test` runs outside Nuxt. This file stands in for what Nuxt would provide.
import { createHash } from 'node:crypto'
import { mock } from 'bun:test'
import { createRoleChecker } from '@type32/nuxt-cs-utils/runtime'

// Auto-imports that shared code relies on.
Object.assign(globalThis, { createRoleChecker })

// `nuxt/server` only loads inside a Nuxt server build.
mock.module('nuxt/server', () => ({
	createError: ({ status, statusText }: { status: number, statusText: string }) =>
		Object.assign(new Error(statusText), { status }),
	// Same shape as the real one: 32 bytes as hex, stable per purpose.
	deriveSecret: async (purpose: string) => createHash('sha256').update(`test-app-secret:${purpose}`).digest('hex'),
}))
