// The decision model's battery (milestones 5–6 plan, 6.4): spike G's messages, asked through a running instance's
// `POST /chats/:id/speakers`, so what is measured is the shipped wording and reading, end to end. Run it as an admin:
// it sets the decision model for the run and puts the setting back.
//
//   SESSION=<value of the nuxt-auth-session cookie> [BASE_URL=http://localhost:3000] bun scripts/decision-battery.ts [--model typesafe/jev-1.14] [--repeats 3]
//
// Two and three participants, in both lane orders, each message `--repeats` times. A case passes when the decision
// model chose the expected speakers in the expected order, or, for a message that asks nobody, when it chose nobody
// (another step decided). Prints every miss; exits non-zero below 95%. About $0.00003 a call; the route allows 20
// calls a minute, so a run of 66 takes about 5 minutes.
import { api } from './smoke-client'

const option = (name: string, fallback: string) => {
	const index = process.argv.indexOf(name)
	return index === -1 ? fallback : process.argv[index + 1] ?? fallback
}
const model = option('--model', 'typesafe/jev-1.14')
const repeats = Number(option('--repeats', '3'))

type Want = string[] | 'everyone' | 'everyone but the Architect' | 'nobody'
const cases: { text: string, want: Want }[] = [
	{ text: 'Engineer, solve this: in how many ways can 8 people sit around a round table, if rotations count as the same seating? Designer, visualise the Engineer\'s solution afterwards.', want: ['Engineer', 'Designer'] },
	{ text: 'Engineer, solve this; Designer, visualise the Engineer\'s solution afterwards', want: ['Engineer', 'Designer'] },
	{ text: 'Designer, please go after the Engineer', want: ['Engineer', 'Designer'] },
	{ text: 'Everyone but the Architect', want: 'everyone but the Architect' },
	{ text: 'What do you all think?', want: 'everyone' },
	{ text: 'Go on.', want: 'nobody' },
]
const lineups = [['Designer', 'Engineer'], ['Engineer', 'Designer'], ['Engineer', 'Designer', 'Architect'], ['Designer', 'Engineer', 'Architect']]

interface Settings { platforms: { openrouter: { hasKey: boolean, decisionModel?: string } } }
const settings = await api<Settings>('GET', '/admin/settings')
const original = settings.platforms.openrouter.decisionModel ?? null
console.log(`decision model for the run: ${model} (setting before: ${original ?? 'none'})`)
await api('PATCH', '/admin/settings', { platforms: { openrouter: { decisionModel: model } } })

const chats: string[] = []
let right = 0
let total = 0
try {
	for (let round = 1; round <= repeats; round++) {
		for (const names of lineups) {
			// One group chat per lineup, made once; nobody answers in it, so every message is a first round.
			const chatId = chats[lineups.indexOf(names)] ?? crypto.randomUUID()
			if (!chats.includes(chatId)) {
				await api('POST', '/chats', { id: chatId, mode: 'group', models: names.map(name => ({ name })), message: { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: 'Hello.' }] } })
				chats.push(chatId)
			}
			const lanes = (await api<{ models: { id: string, name: string | null }[] }>('GET', `/chats/${chatId}`)).models
			for (const { text, want } of cases) {
				if (want === 'everyone but the Architect' && !names.includes('Architect')) continue
				const expected = want === 'everyone' ? names : want === 'everyone but the Architect' ? names.filter(name => name !== 'Architect') : want
				const { speakers, by } = await api<{ speakers: string[], by: string }>('POST', `/chats/${chatId}/speakers`, { text, mentions: [] })
				const got = speakers.map(id => lanes.find(lane => lane.id === id)?.name)
				const ok = expected === 'nobody' ? by !== 'decision' : by === 'decision' && got.join() === expected.join()
				total++
				if (ok) right++
				else console.log(`  miss  [${names.join(', ')}] ${JSON.stringify(text.slice(0, 50))}: got ${got.join(', ')} by ${by}, want ${expected === 'nobody' ? 'no decision' : expected.join(', ')}`)
				// The route allows 20 calls a minute per member.
				await new Promise(resolve => setTimeout(resolve, 3100))
			}
		}
		console.log(`round ${round}: ${right} of ${total} so far`)
	}
}
finally {
	for (const chatId of chats) await api('DELETE', `/chats/${chatId}`).catch(() => {})
	await api('PATCH', '/admin/settings', { platforms: { openrouter: { decisionModel: original } } })
	console.log(`Decision model setting restored to ${original ?? 'none'}.`)
}

const score = total ? right / total : 0
console.log(`${right} of ${total} (${Math.round(score * 100)}%) with ${model}.`)
process.exitCode = score >= 0.95 ? 0 : 1
