import {useServerUsers} from "#server/utils/core/useServerUsers";

export default defineNitroPlugin((nitroApp) => {
	nitroApp.hooks.hook("request", async (event) => {
		event.context.$authorization = {
			resolveServerUser: async () => {
				const session = await getUserSession(event);
				// nuxt-authorization treats only `null` as a guest.
				return (await useServerUsers().getDbUserFromId(session.user?.id)) ?? null;
			},
		};
	});
});
