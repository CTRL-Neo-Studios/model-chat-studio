import { createError, type RequestEvent } from "nuxt/server";
import { db, schema } from 'hub:db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { RoleCheckOptions } from "@type32/nuxt-cs-utils";
import type { UserRole, User } from "#shared/types/db";
import {satisfies} from "#shared/utils/roles";

const userIdSchema = z.uuid()

export function useServerAuth() {

	/** Loads a user by id. Ids that are not UUIDs (old cookies, bad route params) find nobody. */
	async function getDbUserFromId(userId?: string): Promise<User | undefined> {
		if (!userIdSchema.safeParse(userId).success) return;
		return await db.query.user.findFirst({
			where: eq(schema.user.id, userId!)
		})
	}

	async function getDbUserFromSession(event: RequestEvent): Promise<User | undefined> {
		const session = await getUserSession(event)
		return await getDbUserFromId(session.user?.id)
	}

	/**
	 * Returns the raw nuxt-auth-utils session (sealed cookie contents).
	 */
	async function getRawSession(event: RequestEvent) {
		return await getUserSession(event);
	}

	/**
	 * Returns the database user for the session, or undefined.
	 * Does NOT throw — callers that need a guaranteed user should use `requireUser`.
	 */
	async function getUser(event: RequestEvent): Promise<User | undefined> {
		return await getDbUserFromSession(event);
	}

	async function isSessionAuthenticated(event: RequestEvent): Promise<boolean> {
		return !!(await getUser(event));
	}

	async function requireSession(
		event: RequestEvent,
		opts?: RoleCheckOptions<UserRole>,
	) {
		const user = await getDbUserFromSession(event);

		// Without options this still rejects a banned user.
		if (!user || !satisfies(user, opts)) {
			throw createError({ status: 403, statusText: "Unauthorized" });
		}

		return { user };
	}

	async function requireUser(
		event: RequestEvent,
		opts?: RoleCheckOptions<UserRole>,
	): Promise<User> {
		return (await requireSession(event, opts)).user;
	}

	async function isSession(
		event: RequestEvent,
		opts?: RoleCheckOptions<UserRole>,
	): Promise<boolean> {
		const user = await getUser(event);
		if (!user) return false;
		return opts ? satisfies(user, opts) : true;
	}

	return {
		getDbUserFromId,
		getUserSession: getRawSession,
		getUser,
		isSessionAuthenticated,
		requireSession,
		requireUser,
		isSession,
	};
}
