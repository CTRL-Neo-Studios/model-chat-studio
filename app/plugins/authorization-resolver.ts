import type { User } from "#shared/types/db";

export default defineNuxtPlugin({
	name: "authorization-resolver",
	parallel: true,
	setup() {
		return {
			provide: {
				authorization: {
					// The session user only has display fields; client checks are cosmetic, the server decides.
					resolveClientUser: () => useUserSession().user.value as User | null,
				},
			},
		};
	},
});
