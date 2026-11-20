// Live check of the inference adapters against the real platforms. Costs a few cents at most.
//
//   OPENROUTER_API_KEY=… bun scripts/inference-smoke.ts
//   DEEPSEEK_API_KEY=… bun scripts/inference-smoke.ts
//
// With both keys it also continues the OpenRouter conversation on DeepSeek, to check that history
// written by one platform replays on the other. Override models with OPENROUTER_MODEL / DEEPSEEK_MODEL.
import { type ModelMessage, streamText } from 'ai'
import { deepseekPlatform } from '../server/utils/inference/deepseek'
import { openrouterPlatform } from '../server/utils/inference/openrouter'
import type { InferencePlatform } from '../server/utils/inference/types'

const runs = [
	{ platform: openrouterPlatform, apiKey: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_MODEL ?? 'deepseek/deepseek-chat' },
	{ platform: deepseekPlatform, apiKey: process.env.DEEPSEEK_API_KEY, model: process.env.DEEPSEEK_MODEL ?? 'deepseek-flash' },
].filter((run): run is typeof run & { apiKey: string } => !!run.apiKey)

if (!runs.length) {
	console.error('Set OPENROUTER_API_KEY and/or DEEPSEEK_API_KEY.')
	process.exit(1)
}

async function turn(platform: InferencePlatform, apiKey: string, model: string, messages: ModelMessage[], providers?: string[]) {
	const prepared = platform.prepare({
		apiKey, model, providers, userId: 'smoke-test', firstTurn: messages.length === 1, safetyCheck: false,
		reasoningLevel: 'low', webSearch: true, maxOutputTokens: 800,
	})
	const result = streamText({ ...prepared, messages, maxRetries: 0 })
	const kinds = new Map<string, number>()
	for await (const part of result.fullStream) {
		kinds.set(part.type, (kinds.get(part.type) ?? 0) + 1)
		if (part.type === 'error') throw part.error
	}
	console.log('  parts:', Object.fromEntries(kinds))
	console.log('  text:', (await result.text).slice(0, 160).replace(/\s+/g, ' '))
	console.log('  usage:', platform.usage({ model, steps: await result.steps }))
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
	console.log('  catalog:', models.length, 'models; this one:', JSON.stringify(models.find(m => m.id === model)))

	let providers: string[] | undefined
	if (platform.listEndpoints) {
		const endpoints = await platform.listEndpoints(apiKey, model)
		console.log('  endpoints:', endpoints.map(e => `${e.tag} (${e.name}, status ${e.status})`).join(', '))
		const healthy = endpoints.find(e => e.status === 0)
		providers = healthy ? [healthy.tag] : undefined
		console.log('  routing to:', providers)
	}

	const question: ModelMessage = { role: 'user', content: 'In one sentence, what did the most recent Nuxt release add? Cite a source.' }
	const answer = await turn(platform, apiKey, model, history ? [...history, question] : [question], providers)
	history = [...(history ?? [question]), ...answer]
	if (runs.length > 1) console.log('  (the next platform continues this conversation)')
}
