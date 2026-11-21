import { createError } from 'nuxt/server'

interface Window {
	count: number
	resetAt: number
}

// ponytail: per-process memory, like the catalog cache; a shared store if the app ever runs on several instances.
const windows = new Map<string, Window>()

/**
 * Fixed-window counter: takes one request from `key`'s allowance of `limit` per `windowMs`.
 * Returns 0 when allowed, else the milliseconds until the window resets.
 */
export function takeRateLimitToken(key: string, limit: number, windowMs: number, now = Date.now()): number {
	let window = windows.get(key)
	if (!window || window.resetAt <= now) {
		window = { count: 0, resetAt: now + windowMs }
		windows.set(key, window)
	}
	if (window.count >= limit) return window.resetAt - now
	window.count++
	return 0
}

/** Answers 429 with how long to wait when `key` has used its allowance. */
export function assertRateLimit(key: string, limit: number, windowMs: number, what: string) {
	const waitMs = takeRateLimitToken(key, limit, windowMs)
	if (waitMs) {
		throw createError({ status: 429, statusText: `Too many ${what}. Try again in ${Math.ceil(waitMs / 1000)} s.` })
	}
}
