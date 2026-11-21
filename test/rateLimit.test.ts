import { expect, test } from 'bun:test'
import { takeRateLimitToken } from '../server/utils/core/rateLimit'

test('allows the limit per window per key, says how long to wait, and starts over after the window', () => {
	const start = 1_000_000
	for (let i = 0; i < 3; i++) expect(takeRateLimitToken('a', 3, 60_000, start + i)).toBe(0)
	expect(takeRateLimitToken('a', 3, 60_000, start + 10_000)).toBe(50_000)
	// Another member has their own allowance.
	expect(takeRateLimitToken('b', 3, 60_000, start + 10_000)).toBe(0)
	expect(takeRateLimitToken('a', 3, 60_000, start + 60_000)).toBe(0)
})
