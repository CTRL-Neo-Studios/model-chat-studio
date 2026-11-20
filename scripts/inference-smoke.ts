// Live check of the inference adapters against the real platforms. Costs a few cents at most.
//
//   OPENROUTER_API_KEY=… bun scripts/inference-smoke.ts
//   DEEPSEEK_API_KEY=… bun scripts/inference-smoke.ts
//
// With both keys it also continues the OpenRouter conversation on DeepSeek (`--reverse`: DeepSeek first), to check
// that history written by one platform replays on the other. Override models with OPENROUTER_MODEL / DEEPSEEK_MODEL.
//
// Every turn also declares a function tool, as chat turns will (the chart tool). DeepSeek's docs leave open
// whether one can sit beside its web tools; a 400 here means it cannot.
import { type ModelMessage, streamText, tool } from 'ai'
import { z } from 'zod'
import { deepseekPlatform } from '../server/utils/inference/deepseek'
import { openrouterPlatform } from '../server/utils/inference/openrouter'
import type { CatalogModel, InferencePlatform } from '../server/utils/inference/types'

const chart = tool({
	description: 'Draw a chart. Only use it when the user asks for a chart.',
	inputSchema: z.object({ values: z.array(z.number()) }),
	execute: async () => 'drawn',
})

interface ChatRequestBody {
	tools?: { type: string, function?: { name: string } }[]
	messages?: Record<string, unknown>[]
	thinking?: unknown
	reasoning?: unknown
}

// Prints the shape of every chat request (tools, and each message's role and fields), never its text,
// so a turn's behavior can be traced to what was actually sent.
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
	const url = String(input instanceof Request ? input.url : input)
	if (init?.method === 'POST' && typeof init.body === 'string' && url.endsWith('/chat/completions')) {
		const body = JSON.parse(init.body) as ChatRequestBody
		const tools = (body.tools ?? []).map(tool => tool.function?.name ?? tool.type)
		const messages = (body.messages ?? []).map(message => `${message.role}{${Object.keys(message).filter(key => key !== 'role').map(key => {
			const value = message[key]
			return typeof value === 'string' ? `${key}:${value.length}` : key
		}).join(',')}}`)
		console.log(`  request: tools=[${tools.join(', ')}] thinking=${JSON.stringify(body.thinking ?? body.reasoning)}`)
		console.log(`           messages=[${messages.join(' ')}]`)
	}
	return realFetch(input, init)
}) as typeof fetch

const runs = [
	{ platform: openrouterPlatform, apiKey: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_MODEL ?? 'deepseek/deepseek-v4.1-flash' },
	{ platform: deepseekPlatform, apiKey: process.env.DEEPSEEK_API_KEY, model: process.env.DEEPSEEK_MODEL ?? 'deepseek-flash' },
].filter((run): run is typeof run & { apiKey: string } => !!run.apiKey)

// `--reverse` starts on DeepSeek and continues on OpenRouter, so DeepSeek's reasoning parts are replayed there.
if (process.argv.includes('--reverse')) runs.reverse()

if (!runs.length) {
	console.error('Set OPENROUTER_API_KEY and/or DEEPSEEK_API_KEY.')
	process.exit(1)
}

/** `low` when the model lists it, else its first other level, `on` for a toggle-only model, nothing without reasoning. */
function reasoningLevelFor(model: CatalogModel | undefined): string | undefined {
	if (!model?.reasoning) return undefined
	if (model.reasoningLevels.includes('low')) return 'low'
	return model.reasoningLevels.find(level => level !== 'none') ?? 'on'
}

async function turn(platform: InferencePlatform, apiKey: string, model: string, reasoningLevel: string | undefined, messages: ModelMessage[], providers?: string[]) {
	const prepared = platform.prepare({
		apiKey, model, providers, userId: 'smoke-test', firstTurn: messages.length === 1, safetyCheck: false,
		reasoningLevel, webSearch: true, maxOutputTokens: 800,
	})
	console.log('  reasoning level:', reasoningLevel)
	const result = streamText({ ...prepared, tools: { ...prepared.tools, chart }, messages, maxRetries: 0 })
	const kinds = new Map<string, number>()
	const sources: string[] = []
	for await (const part of result.fullStream) {
		kinds.set(part.type, (kinds.get(part.type) ?? 0) + 1)
		if (part.type === 'source' && part.sourceType === 'url') sources.push(part.url)
		if (part.type === 'error') throw part.error
	}
	console.log('  parts:', Object.fromEntries(kinds))
	console.log('  sources:', sources)
	const steps = await result.steps
	console.log('  finish:', await result.finishReason, '| per step:', steps.map(step => step.finishReason), '| warnings:', steps.flatMap(step => step.warnings ?? []))
	console.log('  text:', (await result.text).replace(/\s+/g, ' '))
	console.log('  usage:', platform.usage({ model, steps }))
	return (await result.response).messages
}

let history: ModelMessage[] | undefined
for (const { platform, apiKey, model } of runs) {
	console.log(`\n=== ${platform.id} / ${model}`)
	if (!(await platform.checkKey(apiKey))) {
		console.log('  the platform rejected this key')
		process.exitCode = 1
		continue
	}
	const models = await platform.listModels(apiKey)
	const entry = models.find(m => m.id === model)
	console.log('  catalog:', models.length, 'models; this one:', JSON.stringify(entry))

	let providers: string[] | undefined
	if (platform.listEndpoints) {
		const endpoints = await platform.listEndpoints(apiKey, model)
		console.log('  endpoints:', endpoints.map(e => `${e.tag} (${e.name}, status ${e.status})`).join(', '))
		const healthy = endpoints.find(e => e.status === 0)
		providers = healthy ? [healthy.tag] : undefined
		console.log('  routing to:', providers)
	}

	const question: ModelMessage = { role: 'user', content: 'In one sentence, what did the most recent Nuxt release add? Cite a source.' }
	const answer = await turn(platform, apiKey, model, reasoningLevelFor(entry), history ? [...history, question] : [question], providers)
	history = [...(history ?? [question]), ...answer]
	if (runs.length > 1 && platform !== runs.at(-1)!.platform) console.log('  (the next platform continues this conversation)')
}
