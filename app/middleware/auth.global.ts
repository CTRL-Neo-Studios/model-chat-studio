/**
 * Every page needs a signed-in user unless it opts out with `definePageMeta({ auth: ... })`:
 * `'guest'` for pages only signed-out people should see, `false` for pages anyone may see.
 */
export default defineNuxtRouteMiddleware((to) => {
	const { loggedIn } = useUserSession()
	const auth = to.meta.auth ?? 'user'

	if (auth === false) return
	if (auth === 'guest') return loggedIn.value ? navigateTo('/') : undefined
	if (!loggedIn.value) return navigateTo('/signin')
})
