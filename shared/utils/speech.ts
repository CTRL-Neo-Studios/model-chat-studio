/** The most characters of text one speech call reads. */
export const SPEECH_PIECE_MAX = 1000
/** The most characters of one answer that are read aloud. */
export const SPEECH_ANSWER_MAX = 20_000
/** The first piece is short so the first sound comes quickly; the rest are longer (milestone 10 plan, spike L). */
export const SPEECH_PIECE_SIZES = { first: 250, rest: 600 }

/**
 * Markdown as it is read aloud: code blocks and tables left out; links read as their text; images, bare URLs and
 * HTML tags dropped; headings, quotes, list markers, rules and emphasis marks removed. Underscores inside words
 * (`snake_case`) stay.
 */
export function plainForSpeech(markdown: string) {
	const lines = markdown
		.replace(/\r\n?/g, '\n')
		// Fenced code, and a fence left open at the end.
		.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gm, '')
		.replace(/^ {0,3}(`{3,}|~{3,})[\s\S]*$/m, '')
		.split('\n')
		// Table rows and their separator lines.
		.filter(line => !/^\s*\|.*\|\s*$/.test(line) && !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line))
	// Inline code is read as it is: kept aside while emphasis marks come off, so `__init__.py` keeps its underscores.
	const spans: string[] = []
	return lines.join('\n')
		.replace(/`([^`\n]+)`/g, (_, code: string) => `\u0000${spans.push(code) - 1}\u0000`)
		.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/<https?:\/\/[^>]+>|https?:\/\/\S+/g, '')
		.replace(/<\/?[a-z][^>]*>/gi, '')
		.replace(/^ {0,3}#{1,6}\s+/gm, '')
		.replace(/^[ \t]*>[ \t]?/gm, '')
		.replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/gm, '')
		.replace(/^[ \t]*([-*+]|\d+[.)])[ \t]+/gm, '')
		.replace(/(\*\*|__)(\S(?:[\s\S]*?\S)?)\1/g, '$2')
		.replace(/\*(\S(?:[^*]*?\S)?)\*/g, '$1')
		.replace(/(?<![\p{L}\p{N}])_(\S(?:[^_]*?\S)?)_(?![\p{L}\p{N}])/gu, '$1')
		.replace(/~~(\S(?:[\s\S]*?\S)?)~~/g, '$1')
		.replace(/\0(\d+)\0/g, (_, index: string) => spans[Number(index)]!)
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
}

/** An answer's text as it is read aloud: its text parts (not reasoning, tools or files), plain, at most 20,000 characters. */
export function speechText(parts: { type: string, text?: string }[]) {
	const text = plainForSpeech(parts.flatMap(part => part.type === 'text' && part.text ? [part.text] : []).join('\n\n'))
	return text.length > SPEECH_ANSWER_MAX ? text.slice(0, SPEECH_ANSWER_MAX) : text
}

/** A sentence longer than `max`, at its last space or punctuation before the limit; text without any is cut at it. */
function splitLong(sentence: string, max: number): string[] {
	const pieces: string[] = []
	let rest = sentence
	while (rest.length > max) {
		const window = rest.slice(0, max)
		const at = Math.max(window.lastIndexOf(' '), window.search(/[,;:，、；：][^,;:，、；：]*$/) + 1)
		const cut = at > max / 2 ? at : max
		pieces.push(rest.slice(0, cut))
		rest = rest.slice(cut)
	}
	return [...pieces, rest]
}

/**
 * Text cut at sentence ends into the pieces it is read in: the first about `first` characters, the others about
 * `rest`, none over `SPEECH_PIECE_MAX`. A sentence is kept whole unless it is over that.
 */
export function speechPieces(text: string, sizes = SPEECH_PIECE_SIZES) {
	const sentences = [...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text)]
		.flatMap(({ segment }) => segment.length > SPEECH_PIECE_MAX ? splitLong(segment, SPEECH_PIECE_MAX) : [segment])
	const pieces: string[] = []
	let current = ''
	for (const sentence of sentences) {
		const target = pieces.length ? sizes.rest : sizes.first
		if (current.trim() && (current + sentence).trim().length > Math.min(target, SPEECH_PIECE_MAX)) {
			pieces.push(current.trim())
			current = ''
		}
		current += sentence
	}
	if (current.trim()) pieces.push(current.trim())
	return pieces
}
