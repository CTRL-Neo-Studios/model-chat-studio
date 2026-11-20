import { defineEventHandler, sendRedirect } from 'nuxt/server'

export default defineEventHandler(async (event) => {
	await clearUserSession(event);
	return sendRedirect(event, "/signin");
});
