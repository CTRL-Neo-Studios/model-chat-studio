import { describe, expect, test } from 'bun:test'
import { plainForSpeech, SPEECH_ANSWER_MAX, SPEECH_PIECE_MAX, speechPieces, speechText } from '../shared/utils/speech'
import { deepseekSpeechCost } from '../server/utils/inference/deepseek'

describe('what is read', () => {
	test('Markdown becomes plain text: code and tables left out, links read as their text', () => {
		const markdown = [
			'## The plan',
			'',
			'Use **bold** and *italic* words, `inline code`, and ~~struck~~ ones. Keep snake_case_names and `__init__.py` as they are.',
			'',
			'> A quoted line.',
			'',
			'- first item',
			'2. second item',
			'',
			'```ts',
			'const secret = 42',
			'```',
			'',
			'| a | b |',
			'|---|:-:|',
			'| 1 | 2 |',
			'',
			'See [the guide](https://example.com/guide) or <https://example.com>, ![a chart](chart.png) and https://example.com/raw.',
			'',
			'---',
			'Done <br> here.',
		].join('\n')
		expect(plainForSpeech(markdown)).toBe([
			'The plan',
			'',
			'Use bold and italic words, inline code, and struck ones. Keep snake_case_names and __init__.py as they are.',
			'',
			'A quoted line.',
			'',
			'first item',
			'second item',
			'',
			'See the guide or ,  and',
			'',
			'Done  here.',
		].join('\n'))
	})

	test('a code block left open at the end (a stopped answer) is left out too', () => {
		expect(plainForSpeech('Here it is:\n\n```python\nprint(1)\nprint(2)')).toBe('Here it is:')
	})

	test('an answer: its text parts only, at most 20,000 characters', () => {
		const parts = [
			{ type: 'reasoning', text: 'Thinking it over.' },
			{ type: 'text', text: 'First part.' },
			{ type: 'tool-chart', text: undefined },
			{ type: 'file' },
			{ type: 'text', text: 'Second **part**.' },
		]
		expect(speechText(parts)).toBe('First part.\n\nSecond part.')
		expect(speechText([{ type: 'text', text: 'word '.repeat(10_000) }]).length).toBe(SPEECH_ANSWER_MAX)
	})
})

describe('pieces', () => {
	const sentence = (n: number) => `This is sentence number ${n}, which has a few words in it.`

	test('cut at sentence ends: the first piece about 250 characters, the others about 600', () => {
		const text = Array.from({ length: 40 }, (_, n) => sentence(n + 1)).join(' ')
		const pieces = speechPieces(text)
		expect(pieces[0]!.length).toBeLessThanOrEqual(250)
		expect(pieces[0]!.length).toBeGreaterThan(190)
		for (const piece of pieces.slice(1, -1)) {
			expect(piece.length).toBeLessThanOrEqual(600)
			expect(piece.length).toBeGreaterThan(540)
		}
		for (const piece of pieces) expect(piece).toMatch(/\.$/)
		expect(pieces.join(' ')).toBe(text)
	})

	test('a sentence over the size of its piece stays whole; one over 1,000 characters is cut at a space', () => {
		const long = `${'word '.repeat(80).trim()}.`
		expect(speechPieces(`${long} Short one.`)).toEqual([long, 'Short one.'])
		const huge = `${'word '.repeat(500).trim()}.`
		const pieces = speechPieces(huge)
		expect(pieces.every(piece => piece.length <= SPEECH_PIECE_MAX)).toBe(true)
		expect(pieces.join(' ')).toBe(huge)
	})

	test('Chinese is cut at its own sentence ends; text without spaces is cut at the limit', () => {
		const chinese = '港口在小镇醒来之前就醒了。渔船从防波堤外驶出。'.repeat(20)
		const pieces = speechPieces(chinese)
		expect(pieces.length).toBeGreaterThan(1)
		for (const piece of pieces) expect(piece).toMatch(/。$/)
		expect(pieces.join('')).toBe(chinese)
		const unbroken = '字'.repeat(2500)
		expect(speechPieces(unbroken).map(piece => piece.length)).toEqual([1000, 1000, 500])
	})

	test('empty text has no pieces', () => {
		expect(speechPieces('  \n ')).toEqual([])
	})
})

test('DeepSeek\'s speech price: $0.45 per 10,000 characters, a Chinese character counting as two', () => {
	expect(deepseekSpeechCost('a'.repeat(10_000))).toBeCloseTo(0.45, 10)
	expect(deepseekSpeechCost('港口 ok')).toBeCloseTo((2 * 2 + 3) * 0.45 / 10_000, 12)
})
