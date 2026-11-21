// Test files for the live smoke scripts: a spoken sentence, and a PNG and a PDF that each hold a secret word.
// macOS makes them (`say`, `cupsfilter`, `sips`); elsewhere pass `--wav file.wav` (16-bit PCM WAV),
// `--image file.png` and `--pdf file.pdf` holding the same words.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const SENTENCE = 'Please summarize the attached report in three bullet points.'
export const IMAGE_WORD = 'pineapple'
export const PDF_WORD = 'mango'

const arg = (name: string) => {
	const index = process.argv.indexOf(`--${name}`)
	return index === -1 ? undefined : process.argv[index + 1]
}

/** A one-page PDF of `text`, printed by macOS. */
function printPdf(dir: string, name: string, text: string) {
	writeFileSync(join(dir, `${name}.txt`), `${text}\n`)
	const pdf = join(dir, `${name}.pdf`)
	writeFileSync(pdf, execFileSync('cupsfilter', [join(dir, `${name}.txt`)], { stdio: ['ignore', 'pipe', 'ignore'] }))
	return pdf
}

export function makeSmokeFiles() {
	const dir = mkdtempSync(join(tmpdir(), 'smoke-'))
	const wav = arg('wav') ?? join(dir, 'speech.wav')
	if (!arg('wav')) execFileSync('say', ['-o', wav, '--data-format=LEI16@16000', SENTENCE])
	const pdf = arg('pdf') ?? printPdf(dir, 'secret', `The secret word in this PDF is ${PDF_WORD}.`)
	const image = arg('image') ?? join(dir, 'secret.png')
	if (!arg('image')) execFileSync('sips', ['-s', 'format', 'png', printPdf(dir, 'image', `The secret word in this image is ${IMAGE_WORD}.`), '--out', image], { stdio: 'ignore' })
	return { dir, wav: new Uint8Array(readFileSync(wav)), pdf: new Uint8Array(readFileSync(pdf)), image: new Uint8Array(readFileSync(image)) }
}
