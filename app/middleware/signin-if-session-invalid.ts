import { useAuthSession } from "~/composables/core/useAuthSession";

export default defineNuxtRouteMiddleware(() => {
	const { loggedIn, user } = useAuthSession();
	if (!unref(loggedIn) || !unref(user)) {
		return navigateTo("/signin");
	}
});
