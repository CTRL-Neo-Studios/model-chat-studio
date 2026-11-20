import { createError, type RequestEvent } from 'nuxt/server'
import { authorize as checkAbility, AuthorizationError, type BouncerAbility, type BouncerArgs } from 'nuxt-authorization/utils'
import type { User } from '#shared/types/db'

interface AuthorizationContext {
	resolveServerUser: () => Promise<User | null | undefined>
}

/**
 * Use this instead of nuxt-authorization's server `authorize`, which lets a request through
 * when an ability or the user lookup throws, and treats only `null` (not `undefined`) as a guest.
 *
 * Denials become HTTP errors with the ability's status (403 by default). Any other error is rethrown.
 */
export async function authorize<A extends BouncerAbility<User>>(event: RequestEvent, ability: A, ...args: BouncerArgs<A>): Promise<void> {
	const context = event.context.$authorization as AuthorizationContext
	const user = (await context.resolveServerUser()) ?? null
	try {
		await checkAbility(ability, user, ...args)
	}
	catch (error) {
		if (error instanceof AuthorizationError) {
			throw createError({ status: error.statusCode, statusText: error.message })
		}
		throw error
	}
}
