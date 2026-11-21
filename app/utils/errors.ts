/** The message the server sent with a failed `$fetch`, if any. */
export function serverMessage(error: unknown): string | undefined {
	const data = typeof error === 'object' && error !== null && 'data' in error ? error.data : undefined
	return typeof data === 'object' && data !== null && 'message' in data && typeof data.message === 'string' ? data.message : undefined
}
