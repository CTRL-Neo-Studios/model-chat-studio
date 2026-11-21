// Phase 9 smoke run: drives a running instance through its own API, as the browser does, on each platform
// that has an instance key. Run it as an admin: it switches the active platform and switches it back.
//
//   SESSION=<value of the nuxt-auth-session cookie> [BASE_URL=http://localhost:3000] bun scripts/app-smoke.ts [--search]
//
// Per platform: a plain turn, an image and a PDF, a regenerate, dictation, the spend ledger, and deleting
// the chat. `--search` adds a web search turn (on OpenRouter that costs about $0.02).
// The test files come from `scripts/smoke-files.ts` (macOS makes them; elsewhere `--wav`, `--image`, `--pdf`).
import { IMAGE_WORD, makeSmokeFiles, PDF_WORD, SENTENCE } from './smoke-files'

const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
if (!process.env.SESSION) {
	console.error('Set SESSION to the value of the nuxt-auth-session cookie of an admin (browser dev tools, Application > Cookies).')
	process.exit(1)
}

// Cookies: the session, plus whatever the first page sets (the CSRF secret).
const cookies: Record<string, string> = { 'nuxt-auth-session': process.env.SESSION }
const cookieHeader = () => Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join('; ')
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

interface Turn { text: string, messageId?: string, metadata?: Record<string, unknown>, error?: string, sources: string[] }

/** Sends a turn and reads the UI message stream the way the chat page does. */
async function turn(chatId: string, body: unknown): Promise<Turn> {
	const response = await fetch(`${BASE}/api/v1/chats/${chatId}`, {
		method: 'POST',
		headers: { 'cookie': cookieHeader(), 'csrf-token': csrf!, 'content-type': 'application/json' },
		body: JSON.stringify(body),
	})
	if (!response.ok) throw new Error(`turn answered ${response.status}: ${(await response.text()).slice(0, 300)}`)
	const result: Turn = { text: '', sources: [] }
	for (const line of (await response.text()).split('\n')) {
		if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
		const chunk = JSON.parse(line.slice(6))
		if (chunk.type === 'start') result.messageId = chunk.messageId
		if (chunk.type === 'text-delta') result.text += chunk.delta
		if (chunk.type === 'source-url') result.sources.push(chunk.url)
		if (chunk.type === 'error') result.error = chunk.errorText
		if (chunk.messageMetadata) result.metadata = { ...result.metadata, ...chunk.messageMetadata }
	}
	if (result.error) throw new Error(`the turn failed: ${result.error}`)
	return result
}

let failures = 0
async function step(name: string, run: () => Promise<string>) {
	try {
		console.log(`  ok    ${name}: ${await run()}`)
	}
	catch (error) {
		failures++
		console.log(`  FAIL  ${name}: ${(error as Error).message}`)
	}
}

const summary = (t: Turn) => `${JSON.stringify(t.text.trim().slice(0, 100))} (${[t.metadata?.model, t.metadata?.provider, typeof t.metadata?.costUsd === 'number' ? `$${(t.metadata.costUsd as number).toFixed(6)}` : 'cost unknown'].filter(Boolean).join(', ')})`

type PlatformId = 'openrouter' | 'deepseek'
interface Settings { inferencePlatform: PlatformId | null, platforms: Record<PlatformId, { hasKey: boolean, defaultModel?: string, sttModel?: string }> }
interface Catalog { platform: { id: PlatformId } | null, defaultModel: string | null, models: { id: string, inputModalities: string[], webSearch: boolean }[] }

const files = makeSmokeFiles()
const settings = await api<Settings>('GET', '/admin/settings')
const original = settings.inferencePlatform
const platforms = (['openrouter', 'deepseek'] as const).filter(id => settings.platforms[id].hasKey)
console.log(`${BASE}: instance keys for ${platforms.join(', ') || 'no platform'}; active: ${original ?? 'none'}`)
if (!platforms.length) {
	// Nothing ran, so nothing passed.
	console.error('No platform has an instance key. Add one under /admin/settings (or PATCH /api/v1/admin/settings), then run again.')
	process.exit(1)
}

try {
	for (const platform of platforms) {
		console.log(`\n=== ${platform}`)
		await api('PATCH', '/admin/settings', { inferencePlatform: platform })
		const catalog = await api<Catalog>('GET', '/models')
		const model = catalog.models.find(entry => entry.id === catalog.defaultModel) ?? catalog.models[0]
		if (!model) {
			failures++
			console.log('  FAIL  no model is available: set a default model or allow one')
			continue
		}
		console.log(`  model ${model.id} (reads ${model.inputModalities.join(', ')})`)
		const spentBefore = (await api<{ spentUsd: number }>('GET', '/me/usage')).spentUsd
		const chatId = crypto.randomUUID()
		let lastAnswer: Turn | undefined

		await step('first turn', async () => {
			await api('POST', '/chats', { id: chatId, params: { model: model.id }, message: { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: 'Reply with the single word: pong' }] } })
			lastAnswer = await turn(chatId, { trigger: 'regenerate-message' })
			if (!/pong/i.test(lastAnswer.text)) throw new Error(`expected pong, got ${summary(lastAnswer)}`)
			return summary(lastAnswer)
		})

		await step('image and PDF', async () => {
			const parts: unknown[] = []
			const upload = async (bytes: Uint8Array, name: string, type: string) => {
				const form = new FormData()
				form.append('file', new File([bytes as Uint8Array<ArrayBuffer>], name, { type }))
				const file = await api<{ url: string, mediaType: string, filename: string }>('PUT', `/chats/${chatId}/files`, form)
				parts.push({ type: 'file', url: file.url, mediaType: file.mediaType, filename: file.filename })
			}
			const words = []
			if (model.inputModalities.includes('image')) {
				await upload(files.image, 'secret.png', 'image/png')
				words.push(IMAGE_WORD)
			}
			if (model.inputModalities.includes('file')) {
				await upload(files.pdf, 'secret.pdf', 'application/pdf')
				words.push(PDF_WORD)
			}
			if (!words.length) return 'skipped: the model reads neither images nor PDFs'
			parts.push({ type: 'text', text: 'Each attachment holds one secret word. Reply with just the secret words.' })
			lastAnswer = await turn(chatId, { trigger: 'submit-message', message: { id: crypto.randomUUID(), role: 'user', parts } })
			const missing = words.filter(word => !lastAnswer!.text.toLowerCase().includes(word))
			if (missing.length) throw new Error(`missing ${missing.join(', ')} in ${summary(lastAnswer)}`)
			return summary(lastAnswer)
		})

		await step('regenerate', async () => {
			const before = (await api<{ messages: unknown[] }>('GET', `/chats/${chatId}`)).messages.length
			lastAnswer = await turn(chatId, { trigger: 'regenerate-message', messageId: lastAnswer?.messageId })
			const after = (await api<{ messages: unknown[] }>('GET', `/chats/${chatId}`)).messages.length
			if (after !== before) throw new Error(`the chat went from ${before} to ${after} messages`)
			return summary(lastAnswer)
		})

		if (process.argv.includes('--search')) {
			await step('web search', async () => {
				if (!model.webSearch) return 'skipped: no web search for this model'
				await api('PATCH', `/chats/${chatId}`, { params: { model: model.id, webSearch: true } })
				lastAnswer = await turn(chatId, { trigger: 'submit-message', message: { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: 'What is the latest Nuxt release? One sentence, with a source.' }] } })
				return `${summary(lastAnswer)}, ${lastAnswer.sources.length} sources`
			})
		}

		await step('dictation', async () => {
			const form = new FormData()
			form.append('file', new File([files.wav as Uint8Array<ArrayBuffer>], 'speech.wav', { type: 'audio/wav' }))
			const { text } = await api<{ text: string }>('POST', '/transcriptions', form)
			const words = (value: string) => value.toLowerCase().replace(/[^a-z ]/g, '').split(' ').filter(Boolean)
			const heard = words(text)
			const matched = words(SENTENCE).filter(word => heard.includes(word)).length / words(SENTENCE).length
			if (matched < 0.8) throw new Error(`heard ${JSON.stringify(text)}`)
			return JSON.stringify(text)
		})

		await step('spend ledger', async () => {
			const usage = await api<{ spentUsd: number, budgetUsd: number | null }>('GET', '/me/usage')
			return `$${(usage.spentUsd - spentBefore).toFixed(6)} recorded this run (month: $${usage.spentUsd.toFixed(4)}${usage.budgetUsd === null ? '' : ` of $${usage.budgetUsd}`}; nothing is counted on your own key)`
		})

		await step('delete the chat', async () => {
			await api('DELETE', `/chats/${chatId}`)
			const gone = await fetch(`${BASE}/api/v1/chats/${chatId}`, { headers: { cookie: cookieHeader() } })
			if (gone.status !== 404) throw new Error(`the chat still answers ${gone.status}`)
			return 'gone (404), with its files'
		})
	}
}
finally {
	await api('PATCH', '/admin/settings', { inferencePlatform: original })
	console.log(`\nActive platform restored to ${original ?? 'none'}.`)
}

console.log(failures ? `${failures} step(s) failed.` : 'All steps passed.')
process.exitCode = failures ? 1 : 0
