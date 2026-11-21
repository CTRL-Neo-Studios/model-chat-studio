/**
 * Every page needs a signed-in user unless it opts out with `definePageMeta({ auth: ... })`:
 * `'guest'` for pages only signed-out people should see, `false` for pages anyone may see.
 * `minRole` sends lower roles home. All of this only hides pages; the API checks every request.
 */
export default defineNuxtRouteMiddleware((to) => {
	const { loggedIn, user } = useUserSession()
	const auth = to.meta.auth ?? 'user'

	if (auth === false) return
	if (auth === 'guest') return loggedIn.value ? navigateTo('/') : undefined
	if (!loggedIn.value) return navigateTo('/signin')
	if (to.meta.minRole && getRoleLevel(user.value?.role) < getRoleLevel(to.meta.minRole)) return navigateTo('/')
})
