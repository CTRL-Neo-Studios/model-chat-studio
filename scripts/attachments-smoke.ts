// Live check for phase 7: an image and a PDF reach a model, and a spoken sentence is transcribed, on each
// platform whose key is set. Uses the adapters directly, as the app does.
//
//   OPENROUTER_API_KEY=… DEEPSEEK_API_KEY=… bun scripts/attachments-smoke.ts
//
// macOS makes the test files itself (`say`, `cupsfilter`, `sips`). Elsewhere pass `--wav file.wav` (16-bit PCM),
// `--image file.png` and `--pdf file.pdf`; the image and PDF should each contain a secret word.
// Optional: OPENROUTER_MODEL (must read images), OPENROUTER_STT_MODEL, DEEPSEEK_MODEL.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { convertToModelMessages, streamText, type UIMessage } from 'ai'
import { deepseekPlatform } from '../server/utils/inference/deepseek'
import { openrouterPlatform } from '../server/utils/inference/openrouter'
import type { InferencePlatform } from '../server/utils/inference/types'
import { wavDurationSeconds } from '../server/utils/inference/wav'

const arg = (name: string) => {
	const index = process.argv.indexOf(`--${name}`)
	return index === -1 ? undefined : process.argv[index + 1]
}

const dir = mkdtempSync(join(tmpdir(), 'attachments-smoke-'))
function makeFiles() {
	const sentence = 'Please summarize the attached report in three bullet points.'
	const wav = arg('wav') ?? join(dir, 'speech.wav')
	if (!arg('wav')) execFileSync('say', ['-o', wav, '--data-format=LEI16@16000', sentence])
	const pdf = arg('pdf') ?? join(dir, 'secret.pdf')
	if (!arg('pdf')) {
		writeFileSync(join(dir, 'pdf.txt'), 'The secret word in this PDF is mango.\n')
		writeFileSync(pdf, execFileSync('cupsfilter', [join(dir, 'pdf.txt')], { stdio: ['ignore', 'pipe', 'ignore'] }))
	}
	const image = arg('image') ?? join(dir, 'secret.png')
	if (!arg('image')) {
		writeFileSync(join(dir, 'image.txt'), 'The secret word in this image is pineapple.\n')
		writeFileSync(join(dir, 'image.pdf'), execFileSync('cupsfilter', [join(dir, 'image.txt')], { stdio: ['ignore', 'pipe', 'ignore'] }))
		execFileSync('sips', ['-s', 'format', 'png', join(dir, 'image.pdf'), '--out', image], { stdio: 'ignore' })
	}
	return { sentence, wav: new Uint8Array(readFileSync(wav)), pdf: new Uint8Array(readFileSync(pdf)), image: new Uint8Array(readFileSync(image)) }
}

const files = makeFiles()
console.log(`WAV: ${wavDurationSeconds(files.wav)?.toFixed(1)} s; PDF ${files.pdf.length} B; PNG ${files.image.length} B (in ${dir})`)

const runs: { platform: InferencePlatform, apiKey?: string, model: string, sttModel?: string }[] = [
	{ platform: openrouterPlatform, apiKey: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_MODEL ?? 'deepseek/deepseek-v4.1-flash', sttModel: process.env.OPENROUTER_STT_MODEL ?? 'openai/whisper-1' },
	{ platform: deepseekPlatform, apiKey: process.env.DEEPSEEK_API_KEY, model: process.env.DEEPSEEK_MODEL ?? 'deepseek-flash' },
]
if (!runs.some(run => run.apiKey)) {
	console.error('Set OPENROUTER_API_KEY and/or DEEPSEEK_API_KEY.')
	process.exit(1)
}

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')

for (const { platform, apiKey, model, sttModel } of runs) {
	if (!apiKey) continue
	console.log(`\n=== ${platform.id} / ${model}`)

	try {
		const speech = await platform.transcribe({ apiKey, wav: files.wav, model: sttModel })
		console.log(`  speech: ${JSON.stringify(speech.text)} (cost ${speech.costUsd})`)
		console.log(`  said:   ${JSON.stringify(files.sentence)}`)
	}
	catch (error) {
		console.log(`  speech FAILED: ${(error as Error).message}`)
		process.exitCode = 1
	}

	// The PDF goes the way the app sends it: inline on OpenRouter, uploaded and referenced on DeepSeek.
	let remoteId: string | undefined
	try {
		const pdfPart: UIMessage['parts'][number] = platform.pdfUpload
			? { type: 'file', url: 'https://invalid/', ...platform.pdfUpload.reference(remoteId = (await platform.pdfUpload.upload(apiKey, { bytes: files.pdf, name: 'secret.pdf' })).remoteId) }
			: { type: 'file', mediaType: 'application/pdf', filename: 'secret.pdf', url: `data:application/pdf;base64,${base64(files.pdf)}` }
		if (remoteId) console.log(`  uploaded PDF as ${remoteId}`)
		const messages: UIMessage[] = [{
			id: 'm',
			role: 'user',
			parts: [
				{ type: 'file', mediaType: 'image/png', filename: 'secret.png', url: `data:image/png;base64,${base64(files.image)}` },
				pdfPart,
				{ type: 'text', text: 'There is one secret word in the image and one in the PDF. Reply with just the two words, image first.' },
			],
		}]
		const prepared = platform.prepare({ apiKey, model, userId: 'smoke-test', firstTurn: false, safetyCheck: false, reasoningLevel: 'none' })
		const result = streamText({ ...prepared, messages: await convertToModelMessages(messages), maxRetries: 0 })
		const text = await result.text
		const usage = platform.usage({ model, steps: await result.steps })
		const ok = /pineapple/i.test(text) && /mango/i.test(text)
		console.log(`  answer: ${JSON.stringify(text.trim())} → ${ok ? 'both words found' : 'MISSING a word'}`)
		console.log(`  usage: ${usage.inputTokens} in, ${usage.outputTokens} out, cost ${usage.costUsd}, provider ${usage.provider ?? '-'}`)
		if (!ok) process.exitCode = 1
	}
	catch (error) {
		console.log(`  attachments FAILED: ${(error as Error).message}`)
		process.exitCode = 1
	}
	finally {
		if (remoteId) await platform.pdfUpload!.remove(apiKey, remoteId).then(() => console.log(`  deleted ${remoteId}`), error => console.log(`  delete failed: ${(error as Error).message}`))
	}
}
