// A running instance, driven through its own API as the browser does: the session of an admin, the CSRF token of
// its first page, JSON calls and the UI message stream of one answer. Shared by `app-smoke.ts` and `decision-battery.ts`;
// `signIn` gives a client for another account's session too.

export const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
if (!process.env.SESSION) {
	console.error('Set SESSION to the value of the nuxt-auth-session cookie of an admin (browser dev tools, Application > Cookies).')
	process.exit(1)
}

export interface Turn {
	text: string
	messageId?: string
	metadata?: Record<string, unknown>
	error?: string
	sources: string[]
	/** The tools the model called, by name, in order. */
	tools: string[]
}

/**
 * A client for one session (the value of its `nuxt-auth-session` cookie): its cookies, plus whatever the first page
 * sets (the CSRF secret), and that page's CSRF token. `name` says which variable held it when it does not work.
 */
export async function signIn(session: string, name: string) {
	const cookies: Record<string, string> = { 'nuxt-auth-session': session }
	const cookieHeader = () => Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join('; ')
	const home = await fetch(`${BASE}/`, { headers: { cookie: cookieHeader() }, redirect: 'manual' })
	for (const line of home.headers.getSetCookie()) {
		const [pair] = line.split(';')
		const [key, ...value] = pair!.split('=')
		cookies[key!.trim()] = value.join('=')
	}
	/** The page's CSRF token, for requests `api` cannot make (an audio answer). */
	const csrf = /name="csrf-token" content="([^"]+)"/.exec(await home.text())?.[1]
	if (home.status !== 200 || !csrf) {
		console.error(`The home page answered ${home.status} without a CSRF token: is ${name} a current session?`)
		process.exit(1)
	}

	async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
		const response = await fetch(`${BASE}/api/v1${path}`, {
			method,
			headers: { 'cookie': cookieHeader(), 'csrf-token': csrf!, ...(body !== undefined && !(body instanceof FormData) && { 'content-type': 'application/json' }) },
			body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
		})
		const text = await response.text()
		if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${text.slice(0, 300)}`)
		return text ? JSON.parse(text) : undefined as T
	}

	/** Sends one lane's turn and reads the UI message stream the way the chat page does. */
	async function turn(chatId: string, chatModelId: string, body: Record<string, unknown>): Promise<Turn> {
		const response = await fetch(`${BASE}/api/v1/chats/${chatId}`, {
			method: 'POST',
			headers: { 'cookie': cookieHeader(), 'csrf-token': csrf!, 'content-type': 'application/json' },
			body: JSON.stringify({ ...body, chatModelId }),
		})
		if (!response.ok) throw new Error(`turn answered ${response.status}: ${(await response.text()).slice(0, 300)}`)
		const result: Turn = { text: '', sources: [], tools: [] }
		for (const line of (await response.text()).split('\n')) {
			if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
			const chunk = JSON.parse(line.slice(6))
			if (chunk.type === 'start') result.messageId = chunk.messageId
			if (chunk.type === 'text-delta') result.text += chunk.delta
			if (chunk.type === 'source-url') result.sources.push(chunk.url)
			if (chunk.type === 'tool-input-available') result.tools.push(chunk.toolName)
			if (chunk.type === 'error') result.error = chunk.errorText
			if (chunk.messageMetadata) result.metadata = { ...result.metadata, ...chunk.messageMetadata }
		}
		if (result.error) throw new Error(`the turn failed: ${result.error}`)
		return result
	}

	return { api, turn, cookieHeader, csrf }
}

/** The admin's client, from `SESSION`. */
export const { api, turn, cookieHeader, csrf } = await signIn(process.env.SESSION, 'SESSION (an admin\'s)')
