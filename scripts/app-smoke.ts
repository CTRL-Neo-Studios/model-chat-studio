// Milestone 11 smoke run: drives a running instance through its own API, as the browser does, on each platform
// that has an instance key. Run it as an admin: it switches the active platform and switches it back.
//
//   SESSION=<value of the nuxt-auth-session cookie> [BASE_URL=http://localhost:3000] bun scripts/app-smoke.ts [--search]
//
// Per platform: a plain turn, an image and a PDF, a regenerate, switching to the earlier version and a branch from
// the first message, two models answering one message at once, a library note found and read with the file tools,
// a lorebook note that reaches only its Character's lane once an answer names its keyword (and the Character's card
// exported and imported again), a group round in the order the message asks for, a chat started in a folder whose
// defaults are a group (the second speaker reads the first one's chart), a message refused after an older tip and
// answered after the tip, dictation, a piece read aloud in the platform's default voice, an image drawn by the
// model's tool call and one by `/image` (each about $0.01, once an image model is set), the spend ledger, and deleting
// the chat. `--search` adds web search to the library question and a web search turn (on OpenRouter each costs about
// $0.02). The test files come from `scripts/smoke-files.ts` (macOS makes them; elsewhere `--wav`, `--image`, `--pdf`).
import { IMAGE_WORD, makeSmokeFiles, PDF_WORD, SENTENCE } from './smoke-files'
import { api, BASE, cookieHeader, csrf, turn, type Turn } from './smoke-client'

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
interface Catalog { platform: { id: PlatformId } | null, defaultModel: string | null, models: { id: string, inputModalities: string[], webSearch: boolean }[], images: { available: boolean, reason: string | null } }

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
		let laneId = ''

		await step('first turn', async () => {
			await api('POST', '/chats', { id: chatId, models: [{ modelId: model.id }], message: { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: 'Reply with the single word: pong' }] } })
			laneId = (await api<{ models: { id: string }[] }>('GET', `/chats/${chatId}`)).models[0]!.id
			lastAnswer = await turn(chatId, laneId, { trigger: 'regenerate-message' })
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
			lastAnswer = await turn(chatId, laneId, { trigger: 'submit-message', message: { id: crypto.randomUUID(), role: 'user', parts } })
			const missing = words.filter(word => !lastAnswer!.text.toLowerCase().includes(word))
			if (missing.length) throw new Error(`missing ${missing.join(', ')} in ${summary(lastAnswer)}`)
			return summary(lastAnswer)
		})

		await step('regenerate', async () => {
			const before = (await api<{ messages: unknown[] }>('GET', `/chats/${chatId}`)).messages.length
			lastAnswer = await turn(chatId, laneId, { trigger: 'regenerate-message', messageId: lastAnswer?.messageId })
			const after = (await api<{ messages: unknown[] }>('GET', `/chats/${chatId}`)).messages.length
			if (after !== before) throw new Error(`the chat went from ${before} to ${after} messages`)
			return summary(lastAnswer)
		})

		await step('versions and a branch', async () => {
			type Thread = { messages: { id: string, role: string }[], versions: Record<string, string[]>, branches: Record<string, string[]> }
			const before = await api<Thread>('GET', `/chats/${chatId}`)
			// The regenerate above kept the earlier answer as version 1.
			const answer = before.messages.findLast(entry => entry.role === 'assistant')
			const versions = answer ? before.versions[answer.id] : undefined
			if (!versions || versions.length < 2) throw new Error(`the last answer has ${versions?.length ?? 0} versions`)
			await api('PATCH', `/chats/${chatId}/messages/${versions[0]}`, { active: true })
			if (!(await api<Thread>('GET', `/chats/${chatId}`)).messages.some(entry => entry.id === versions[0])) throw new Error('version 1 is not shown after switching to it')
			// "Save and resend" on the first message: the model answers the new text alone, and the earlier branch comes back whole.
			const first = before.messages.find(entry => entry.role === 'user')!
			const branch = await api<{ id: string }>('PATCH', `/chats/${chatId}/messages/${first.id}`, { text: 'Reply with the single word: ping', branch: true })
			const answered = await turn(chatId, laneId, { trigger: 'regenerate-message', messageId: branch.id })
			if (!/ping/i.test(answered.text)) throw new Error(`expected ping, got ${summary(answered)}`)
			const onBranch = await api<Thread>('GET', `/chats/${chatId}`)
			if (onBranch.messages.length !== 2 || onBranch.branches[branch.id]?.length !== 2) throw new Error(`the branch shows ${onBranch.messages.length} messages and ${onBranch.branches[branch.id]?.length ?? 0} branches`)
			const back = await api<Thread>('PUT', `/chats/${chatId}/tip`, { messageId: first.id })
			if (back.messages.length !== before.messages.length) throw new Error(`back on the earlier branch: ${back.messages.length} messages, ${before.messages.length} before`)
			return `${versions.length} versions, version 1 shown; the branch ${summary(answered)}; back to ${back.messages.length} messages`
		})

		await step('two models', async () => {
			// A second lane with its own system prompt, sending the same message as the first, at the same time.
			const second = await api<{ id: string }>('POST', `/chats/${chatId}/models`, { modelId: model.id, name: 'Second', systemPrompt: 'Whatever you are asked, reply with the single word: second' })
			const message = { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: 'Reply with the single word: pong' }] }
			const [first, other] = await Promise.all([laneId, second.id].map(lane => turn(chatId, lane, { trigger: 'submit-message', message })))
			await api('DELETE', `/chats/${chatId}/models/${second.id}`)
			const { messages } = await api<{ messages: { id: string }[] }>('GET', `/chats/${chatId}`)
			const saved = messages.filter(entry => entry.id === message.id).length
			if (saved !== 1) throw new Error(`the message was saved ${saved} times`)
			if (!/pong/i.test(first!.text) || !/second/i.test(other!.text)) throw new Error(`got ${summary(first!)} and ${summary(other!)}`)
			return `${summary(first!)} and ${summary(other!)}`
		})

		await step('library tools', async () => {
			// A note the model is not given: no tags, so auto-fetch (tags by default) leaves it to the file tools.
			const codename = `KESTREL-${Math.floor(1000 + Math.random() * 9000)}`
			const library = await api<{ id: string }>('POST', '/libraries', { name: `Smoke ${codename}` })
			try {
				await api('POST', `/libraries/${library.id}/entries`, { kind: 'note', name: 'project.md', content: ['# Project notes', '', 'Kick-off on Monday.', 'The team meets on Thursdays.', `Codename: ${codename}`].join('\n') })
				await api('PUT', `/chats/${chatId}/libraries/${library.id}`)
				// With --search, tools and web search in one answer.
				const search = process.argv.includes('--search') && model.webSearch
				if (search) await api('PATCH', `/chats/${chatId}`, { settings: { webSearch: true } })
				const question = `Read the project note in this chat's library and tell me the codename on its last line.${search ? ' Also look up on the web what the latest Nuxt release is, and cite your source.' : ''}`
				lastAnswer = await turn(chatId, laneId, { trigger: 'submit-message', message: { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: question }] } })
				const tools = lastAnswer.tools.join(', ') || 'none'
				if (!lastAnswer.tools.some(name => name === 'list_files' || name === 'search_files') || !lastAnswer.tools.includes('read_file')) throw new Error(`tools called: ${tools}; ${summary(lastAnswer)}`)
				if (!lastAnswer.text.includes(codename)) throw new Error(`no ${codename} after ${tools}: ${summary(lastAnswer)}`)
				if (search && !lastAnswer.sources.length) throw new Error(`no web sources after ${tools}: ${summary(lastAnswer)}`)
				return `${tools}; ${summary(lastAnswer)}${search ? `, ${lastAnswer.sources.length} sources` : ''}`
			}
			finally {
				await api('DELETE', `/libraries/${library.id}`)
			}
		})

		await step('lorebook and the card', async () => {
			// A town only the lorebook knows. The user never writes its name: the first answer does, and the second
			// question asks about "that town". The plain lane beside the Character's never gets the note.
			const town = 'Quorvenna'
			const library = await api<{ id: string }>('POST', '/libraries', { name: 'Smoke lore' })
			const made: { characters: string[], libraries: string[], chats: string[] } = { characters: [], libraries: [library.id], chats: [] }
			try {
				await api('PATCH', `/libraries/${library.id}`, { lorebook: { on: true } })
				const note = await api<{ id: string }>('POST', `/libraries/${library.id}/entries`, { kind: 'note', name: town, tags: [town], content: `{{char}} has been to ${town}: its glass bells ring thirteen times at dusk, which {{user}} has never heard.` })
				const character = await api<{ id: string }>('POST', '/characters', { name: 'Smoke Lorekeeper', instructions: 'You are {{char}}, a guide to far-off towns. Answer in one or two sentences.', libraryIds: [library.id] })
				made.characters.push(character.id)
				const loreChat = crypto.randomUUID()
				made.chats.push(loreChat)
				await api('POST', '/chats', { id: loreChat, models: [{ modelId: model.id, characterId: character.id }, { modelId: model.id, name: 'Plain' }], message: { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: 'Join "Quorv" and "enna" into one word, and reply with only that word.' }] } })
				const [keeperLane, plainLane] = (await api<{ models: { id: string }[] }>('GET', `/chats/${loreChat}`)).models
				const named = await turn(loreChat, keeperLane!.id, { trigger: 'regenerate-message' })
				await turn(loreChat, plainLane!.id, { trigger: 'regenerate-message' })
				if (!named.text.toLowerCase().includes(town.toLowerCase())) throw new Error(`the first answer did not name the town: ${summary(named)}`)
				const message = { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: 'How many times do the bells ring at dusk in that town? Answer with the number in words.' }] }
				const keeper = await turn(loreChat, keeperLane!.id, { trigger: 'submit-message', message })
				const plain = await turn(loreChat, plainLane!.id, { trigger: 'submit-message', message })

				const { traces } = await api<{ traces: { messageId: string, blocks: { kind: string, entryId?: string }[] }[] }>('GET', `/chats/${loreChat}/overview`)
				const sentNote = (answer: Turn) => traces.find(trace => trace.messageId === answer.messageId)?.blocks.some(block => block.kind === 'lore' && block.entryId === note.id)
				if (sentNote(named)) throw new Error('the note was sent before the town was named')
				if (!sentNote(keeper)) throw new Error(`the note was not sent once the answer named the town: ${summary(keeper)}`)
				if (sentNote(plain)) throw new Error('the plain lane was sent the note')
				const knows = (answer: Turn) => /\bthirteen\b|\b13\b/i.test(answer.text)
				if (!knows(keeper)) throw new Error(`the Character did not use the note: ${summary(keeper)}`)
				if (knows(plain)) throw new Error(`the plain lane knew the answer: ${summary(plain)}`)
				if (keeper.tools.length) throw new Error(`the Character called ${keeper.tools.join(', ')}`)
				const cited = /\b(notes?|files?|lorebook|library|sources?)\b/i.exec(keeper.text)
				if (cited) throw new Error(`the Character cited "${cited[0]}": ${summary(keeper)}`)

				// Its card, out and in again: the same Character with the same lorebook note.
				const exported = await fetch(`${BASE}/api/v1/characters/${character.id}/card`, { headers: { cookie: cookieHeader() } })
				if (!exported.ok) throw new Error(`the card export answered ${exported.status}`)
				const form = new FormData()
				form.append('file', new File([await exported.blob()], 'card.json', { type: 'application/json' }))
				const imported = await api<{ character: { id: string, name: string, instructions: string, libraryIds: string[] } }>('POST', '/characters/import', form)
				made.characters.push(imported.character.id)
				made.libraries.push(...imported.character.libraryIds)
				const [copy] = imported.character.libraryIds
				const entries = copy ? await api<{ name: string, tags: string[] }[]>('GET', `/libraries/${copy}/entries`) : []
				const lorebook = copy && (await api<{ lorebook: { on: boolean } | null }>('GET', `/libraries/${copy}`)).lorebook
				if (imported.character.name !== 'Smoke Lorekeeper' || imported.character.instructions !== 'You are {{char}}, a guide to far-off towns. Answer in one or two sentences.' || !lorebook || !lorebook.on || entries.map(entry => `${entry.name}:${entry.tags.join()}`).join() !== `${town}:${town}`) {
					throw new Error(`the card imported as ${JSON.stringify({ name: imported.character.name, lorebook, entries })}`)
				}
				return `the answer named ${town}; then the Character ${summary(keeper)}; Plain ${summary(plain)}; the card came back with its lorebook`
			}
			finally {
				for (const id of made.chats) await api('DELETE', `/chats/${id}`)
				for (const id of made.characters) await api('DELETE', `/characters/${id}`)
				for (const id of made.libraries) await api('DELETE', `/libraries/${id}`)
			}
		})

		await step('group round', async () => {
			// Designer first in lane order: the order has to come from the message.
			const groupId = crypto.randomUUID()
			await api('POST', '/chats', { id: groupId, mode: 'group', models: [{ modelId: model.id, name: 'Designer' }, { modelId: model.id, name: 'Engineer' }], message: { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: 'Hello, both of you.' }] } })
			try {
				const lanes = (await api<{ models: { id: string, name: string | null }[] }>('GET', `/chats/${groupId}`)).models
				const nameOf = (id: string) => lanes.find(lane => lane.id === id)?.name
				const text = 'Engineer, solve this: what is 17 × 23? Designer, put the Engineer\'s result in one sentence afterwards.'
				const order = await api<{ speakers: string[], by: string }>('POST', `/chats/${groupId}/speakers`, { text, mentions: [] })
				if (order.speakers.map(nameOf).join(', ') !== 'Engineer, Designer') throw new Error(`order ${order.speakers.map(nameOf).join(', ')}, by ${order.by}`)
				// One after another, as the chat page asks them.
				const message = { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text }] }
				const answers: Turn[] = []
				for (const id of order.speakers) answers.push(await turn(groupId, id, { trigger: 'submit-message', message }))
				const { messages } = await api<{ messages: { id: string, metadata?: { speakers?: string[] } | null }[] }>('GET', `/chats/${groupId}`)
				const saved = messages.find(entry => entry.id === message.id)?.metadata?.speakers ?? []
				if (saved.join() !== order.speakers.join()) throw new Error(`saved speakers ${saved.map(nameOf).join(', ') || 'none'}`)
				const [engineer, designer] = answers
				const { traces } = await api<{ traces: { messageId: string, blocks: { kind: string, role: string, messageId?: string }[] }[] }>('GET', `/chats/${groupId}/overview`)
				const given = traces.find(trace => trace.messageId === designer!.messageId)?.blocks.some(block => block.kind === 'message' && block.role === 'user' && block.messageId === engineer!.messageId)
				if (!given) throw new Error('the Designer was not given the Engineer\'s answer')
				return `by ${order.by}: Engineer ${summary(engineer!)}, then Designer ${summary(designer!)}`
			}
			finally {
				await api('DELETE', `/chats/${groupId}`)
			}
		})

		await step('folder defaults and a shared chart', async () => {
			// A folder whose defaults are a two-model group; a chat started there with nothing but the folder.
			const folder = await api<{ id: string }>('POST', '/folders', { name: 'Smoke analysts', parentId: null })
			try {
				await api('PATCH', `/folders/${folder.id}`, { defaults: { libraryIds: [], structureProfileId: null, mode: 'group', models: [{ modelId: model.id, name: 'Analyst' }, { modelId: model.id, name: 'Reviewer' }] } })
				const groupId = crypto.randomUUID()
				await api('POST', '/chats', { id: groupId, folderId: folder.id, message: { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: 'Hello, both of you.' }] } })
				type Part = { type: string, input?: { data?: Record<string, string | number>[], xKey?: string, series?: { key: string }[] } }
				const read = () => api<{ folderId: string | null, mode: string, models: { id: string, name: string | null }[], messages: { id: string, role: string, parts: Part[] }[] }>('GET', `/chats/${groupId}`)
				const chat = await read()
				const names = chat.models.map(lane => lane.name).join(', ')
				if (chat.folderId !== folder.id || chat.mode !== 'group' || names !== 'Analyst, Reviewer') throw new Error(`started in ${chat.folderId}, ${chat.mode}, with ${names}`)
				// The Reviewer can only answer from the Analyst's chart: the numbers are made up there.
				const message = { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: 'Analyst: draw a bar chart of made-up monthly sales for four months with the chart tool, and write one short sentence without any numbers. Reviewer: name the month with the highest sales in the Analyst\'s chart, and its value.' }] }
				const [analystLane, reviewerLane] = chat.models
				const analyst = await turn(groupId, analystLane!.id, { trigger: 'submit-message', message })
				if (!analyst.tools.includes('chart')) throw new Error(`the Analyst called ${analyst.tools.join(', ') || 'no tool'}: ${summary(analyst)}`)
				const reviewer = await turn(groupId, reviewerLane!.id, { trigger: 'submit-message', message })
				const input = (await read()).messages.find(entry => entry.id === analyst.messageId)?.parts.find(part => part.type === 'tool-chart')?.input
				const key = input?.series?.[0]?.key ?? ''
				const top = (input?.data ?? []).reduce<Record<string, string | number> | undefined>((best, point) => Number(point[key]) > Number(best?.[key] ?? -Infinity) ? point : best, undefined)
				const value = String(top?.[key] ?? '?')
				if (!reviewer.text.replace(/[,\s]/g, '').includes(value.replace(/[,\s]/g, ''))) throw new Error(`the chart's top is ${top?.[input?.xKey ?? '']} at ${value}; the Reviewer said ${summary(reviewer)}`)
				return `in the folder as Analyst and Reviewer; chart top ${top?.[input?.xKey ?? '']} ${value}; Reviewer ${summary(reviewer)}`
			}
			finally {
				for (const { id } of (await api<{ id: string, folderId: string | null }[]>('GET', '/chats')).filter(entry => entry.folderId === folder.id)) await api('DELETE', `/chats/${id}`)
				await api('DELETE', `/folders/${folder.id}`)
			}
		})

		if (process.argv.includes('--search')) {
			await step('web search', async () => {
				if (!model.webSearch) return 'skipped: no web search for this model'
				await api('PATCH', `/chats/${chatId}`, { settings: { webSearch: true } })
				lastAnswer = await turn(chatId, laneId, { trigger: 'submit-message', message: { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: 'What is the latest Nuxt release? One sentence, with a source.' }] } })
				return `${summary(lastAnswer)}, ${lastAnswer.sources.length} sources`
			})
		}

		await step('the tip check', async () => {
			// A message names the tip it was written after; after an older one (someone else wrote since) it is refused.
			const asked = (await api<{ messages: { id: string, role: string }[] }>('GET', `/chats/${chatId}`)).messages.filter(message => message.role === 'user')
			const [stale, tip] = [asked[0]!.id, asked.at(-1)!.id]
			const message = { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: 'Reply with the single word: pong' }] }
			const refused = await turn(chatId, laneId, { trigger: 'submit-message', message, after: stale }).then(() => 'answered', (error: Error) => error.message)
			if (!refused.includes('409')) throw new Error(`a message after an older tip was ${refused.slice(0, 120)}`)
			lastAnswer = await turn(chatId, laneId, { trigger: 'submit-message', message, after: tip })
			if (!/pong/i.test(lastAnswer.text)) throw new Error(`expected pong, got ${summary(lastAnswer)}`)
			return `refused after an older tip (409), then after the tip ${summary(lastAnswer)}`
		})

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

		await step('read aloud', async () => {
			const voices = await api<{ available: boolean, defaultVoice: string | null }>('GET', '/speech/voices')
			if (!voices.available) return 'skipped: read-aloud is not set up on this platform'
			const response = await fetch(`${BASE}/api/v1/speech`, {
				method: 'POST',
				headers: { 'cookie': cookieHeader(), 'csrf-token': csrf!, 'content-type': 'application/json' },
				body: JSON.stringify({ text: 'This is the smoke run, reading one short sentence aloud.' }),
			})
			const type = response.headers.get('content-type') ?? ''
			const bytes = (await response.arrayBuffer()).byteLength
			if (!response.ok || !type.startsWith('audio/') || bytes < 1000) throw new Error(`answered ${response.status} ${type}, ${bytes} bytes`)
			return `${type}, ${Math.round(bytes / 1024)} KB in ${voices.defaultVoice}`
		})

		await step('images', async () => {
			if (!catalog.images.available) return `skipped: ${catalog.images.reason}`
			await api('PATCH', `/chats/${chatId}`, { settings: { images: true } })
			lastAnswer = await turn(chatId, laneId, { trigger: 'submit-message', message: { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: 'Use the generate_image tool to draw a small red apple on a white table, then say "done".' }] } })
			if (!lastAnswer.tools.includes('generate_image')) throw new Error(`no image drawn: ${summary(lastAnswer)}, tools ${lastAnswer.tools.join(', ') || 'none'}`)
			type Drawn = { type: string, state?: string, output?: { url: string } }
			const shown = await api<{ messages: { id: string, parts: Drawn[] }[] }>('GET', `/chats/${chatId}`)
			const drawn = shown.messages.find(message => message.id === lastAnswer!.messageId)?.parts.find(part => part.type === 'tool-generate_image' && part.state === 'output-available')
			if (!drawn?.output) throw new Error('the answer holds no finished image')
			const exchange = await api<{ drawn: { parts: Drawn[] } }>('POST', `/chats/${chatId}/images`, { prompt: 'a small blue paper boat' })
			const stored = [drawn.output.url, exchange.drawn.parts[0]?.output?.url]
			const types = await Promise.all(stored.map(async url => url ? (await fetch(`${BASE}${url}`, { headers: { cookie: cookieHeader() } })).headers.get('content-type') : 'missing'))
			if (types.some(type => !type?.startsWith('image/'))) throw new Error(`stored images answered ${types.join(', ')}`)
			return `the tool's (${types[0]}) and /image's (${types[1]})`
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
