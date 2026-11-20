declare module '#app' {
	interface PageMeta {
		/** See `app/middleware/auth.global.ts`. Defaults to requiring a signed-in user. */
		auth?: 'guest' | false
	}
}

export {}
