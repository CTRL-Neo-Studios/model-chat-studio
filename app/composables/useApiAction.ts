type Method = 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/**
 * Sends a change to the API with the CSRF header, and toasts the outcome: the server's message on
 * failure (resolving `undefined`), `success` when given.
 */
export function useApiAction() {
	const toast = useToast()
	const { csrf, headerName } = useCsrf()

	return async function act<T>(url: string, options: { method: Method, body?: Record<string, unknown> | FormData, success?: string }): Promise<T | undefined> {
		try {
			const result = await $fetch<T>(url, { method: options.method, body: options.body, headers: { [headerName]: csrf } })
			if (options.success) toast.add({ title: options.success, icon: 'i-lucide-check', color: 'success' })
			return result
		}
		catch (error) {
			toast.add({ title: 'Something went wrong', description: serverMessage(error), icon: 'i-lucide-alert-circle', color: 'error' })
			return undefined
		}
	}
}
