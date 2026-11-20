import { createError, type RequestEvent } from "nuxt/server";
import { db, schema } from "hub:db"
import {eq} from "drizzle-orm";
import {useServerAuth} from "#server/utils/core/useServerAuth";
import {authorize} from "#server/utils/core/authorize";
import {userAbilities} from "#shared/abilities/userAbilities";
import type { PublicUser, User, UserRole } from "#shared/types/db"
import {satisfies} from "#shared/utils/roles";

export interface UserEdit {
	role?: UserRole
	monthlyBudgetUsd?: number | null
}

export function useServerUsers() {
	const $auth = useServerAuth()
	const { getDbUserFromId } = $auth

	async function getUsersHandler(event: RequestEvent): Promise<User[]> {
		await authorize(event, userAbilities().listUsers)

		return await db.query.user.findMany()
	}

	async function getUserHandler(event: RequestEvent, targetUserId: string): Promise<User | PublicUser> {
		await authorize(event, userAbilities().getUser)

		const targetUser = await getDbUserFromId(targetUserId)
		if (!targetUser) throw createError({ status: 404, statusText: "User not found" })

		const requestingUser = await $auth.getUser(event)
		if (requestingUser && (satisfies(requestingUser, { minRole: 'admin' }) || requestingUser.id === targetUserId)) {
			return targetUser
		}

		const { id, username, name, avatarUrl, role, createdAt } = targetUser
		return { id, username, name, avatarUrl, role, createdAt }
	}

	async function editUserHandler(event: RequestEvent, targetUserId: string, values: UserEdit): Promise<User | undefined> {
		await authorize(event, userAbilities().editUser, await getDbUserFromId(targetUserId))

		const [updatedUser] = await db.update(schema.user)
			.set(values)
			.where(eq(schema.user.id, targetUserId))
			.returning()

		return updatedUser
	}

	async function deleteUserHandler(event: RequestEvent, targetUserId: string): Promise<User | undefined> {
		await authorize(event, userAbilities().deleteUser, await getDbUserFromId(targetUserId))

		const [deletedUser] = await db.delete(schema.user)
			.where(eq(schema.user.id, targetUserId))
			.returning()

		return deletedUser
	}

	async function promoteUserHandler(event: RequestEvent, targetUserId: string): Promise<User | undefined> {
		await authorize(event, userAbilities().promoteUser, await getDbUserFromId(targetUserId))

		const [user] = await db.update(schema.user)
			.set({
				role: 'moderator'
			})
			.where(eq(schema.user.id, targetUserId))
			.returning()

		return user
	}

	async function demoteUserHandler(event: RequestEvent, targetUserId: string): Promise<User | undefined> {
		await authorize(event, userAbilities().demoteUser, await getDbUserFromId(targetUserId))

		const [user] = await db.update(schema.user)
			.set({
				role: 'user'
			})
			.where(eq(schema.user.id, targetUserId))
			.returning()

		return user
	}

	async function banUserHandler(event: RequestEvent, targetUserId: string, banReason?: string, banExpires?: Date): Promise<User | undefined> {
		await authorize(event, userAbilities().banUser, await getDbUserFromId(targetUserId))

		const [user] = await db.update(schema.user)
			.set({
				banned: true,
				banReason,
				banExpires
			})
			.where(eq(schema.user.id, targetUserId))
			.returning()

		return user
	}

	async function unbanUserHandler(event: RequestEvent, targetUserId: string): Promise<User | undefined> {
		await authorize(event, userAbilities().unbanUser, await getDbUserFromId(targetUserId))

		const [user] = await db.update(schema.user)
			.set({
				banned: false,
				banReason: null,
				banExpires: null
			})
			.where(eq(schema.user.id, targetUserId))
			.returning()

		return user
	}

	return {
		getDbUserFromId,
		getUsersHandler,
		getUserHandler,
		editUserHandler,
		deleteUserHandler,
		promoteUserHandler,
		demoteUserHandler,
		banUserHandler,
		unbanUserHandler
	}
}
