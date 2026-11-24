import { definePlugin } from 'nitro'
import { useServerHooks } from 'nuxt/server'

// Every rendered page carries the signed-in member (and a per-session CSRF token), so no cache between the app and
// the browser may keep one. Assets and API routes are not rendered pages and keep their own headers.
export default definePlugin(() => {
	useServerHooks().hook('render:html', (_html, { event }) => {
		event.res.headers.set('cache-control', 'private, no-store')
	})
})
