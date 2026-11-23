// A running instance, driven through its own API as the browser does: the session of an admin, the CSRF token of
// its first page, JSON calls and the UI message stream of one answer. Shared by `app-smoke.ts` and `decision-battery.ts`.

export const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
if (!process.env.SESSION) {
	console.error('Set SESSION to the value of the nuxt-auth-session cookie of an admin (browser dev tools, Application > Cookies).')
	process.exit(1)
}

// Cookies: the session, plus whatever the first page sets (the CSRF secret).
const cookies: Record<string, string> = { 'nuxt-auth-session': process.env.SESSION }
export const cookieHeader = () => Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join('; ')
const home = await fetch(`${BASE}/`, { headers: { cookie: cookieHeader() }, redirect: 'manual' })
for (const line of home.headers.getSetCookie()) {
	const [pair] = line.split(';')
	const [name, ...value] = pair!.split('=')
	cookies[name!.trim()] = value.join('=')
}
const csrf = /name="csrf-token" content="([^"]+)"/.exec(await home.text())?.[1]
if (home.status !== 200 || !csrf) {
	console.error(`The home page answered ${home.status} without a CSRF token: is SESSION an admin's current session?`)
	process.exit(1)
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
	const response = await fetch(`${BASE}/api/v1${path}`, {
		method,
		headers: { 'cookie': cookieHeader(), 'csrf-token': csrf!, ...(body !== undefined && !(body instanceof FormData) && { 'content-type': 'application/json' }) },
		body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
	})
	const text = await response.text()
	if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${text.slice(0, 300)}`)
	return text ? JSON.parse(text) : undefined as T
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

/** Sends one lane's turn and reads the UI message stream the way the chat page does. */
export async function turn(chatId: string, chatModelId: string, body: Record<string, unknown>): Promise<Turn> {
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
