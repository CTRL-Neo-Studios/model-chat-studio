import type { UserRole } from '#shared/types/db'

declare module '#app' {
	interface PageMeta {
		/** See `app/middleware/auth.global.ts`. Defaults to requiring a signed-in user. */
		auth?: 'guest' | false
		/** The lowest role that sees the page; others are sent home. The API enforces the same rule. */
		minRole?: UserRole
	}
}

export {}
