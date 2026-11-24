// Every rendered page carries the signed-in member (and a per-session CSRF token), so no cache between the app and
// the browser may keep one. Assets and API routes are not rendered pages and keep their own headers.
export default defineNitroPlugin((nitroApp) => {
	nitroApp.hooks.hook('render:response', (response) => {
		response.headers ??= {}
		response.headers['cache-control'] = 'private, no-store'
	})
})
