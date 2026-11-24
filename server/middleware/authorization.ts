import { defineHandler } from "nuxt/server";
import { useServerAuth } from "#server/utils/core/useServerAuth";

// nuxt-authorization looks up the member through the request context, and treats only `null` as a guest.
// The lookup is shared with the handler's `requireUser`, and only runs when a handler authorizes.
export default defineHandler((event) => {
	event.context.$authorization = {
		resolveServerUser: async () => (await useServerAuth().getUser(event)) ?? null,
	};
});
