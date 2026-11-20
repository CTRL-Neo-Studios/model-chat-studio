// Switching between two chats replaces the page without the view transition.
export default defineNuxtRouteMiddleware((to, from) => {
	if (import.meta.server) return

	if (to.params.id && from.params.id) {
		to.meta.viewTransition = false
	}
})
