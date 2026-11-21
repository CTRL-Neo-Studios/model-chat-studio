import type { RequestEvent } from "nuxt/server";
import { useServerAuth } from "#server/utils/core/useServerAuth";

export default defineNitroPlugin((nitroApp) => {
	nitroApp.hooks.hook("request", async (event) => {
		event.context.$authorization = {
			// nuxt-authorization treats only `null` as a guest. The lookup is shared with the handler's
			// `requireUser` through the request context; the hook's event has the older h3 type.
			resolveServerUser: async () => (await useServerAuth().getUser(event as unknown as RequestEvent)) ?? null,
		};
	});
});
