import type {UserRole} from "#shared/types/db";

declare module "#auth-utils" {
	/** Session user. Display only: the server reads role and ban state from the database. */
	interface User {
		id: string;
		role: UserRole;
		username: string;
		name: string | null;
		avatar: string | null;
	}

	/** Server-only session data, never sent to the browser. */
	interface SecureSessionData {
		/** Set by `/invite/[code]`, claimed at signup. */
		inviteCode?: string;
	}
}

export {};
