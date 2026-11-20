import type { UIMessage } from 'ai'
import { isTextUIPart } from 'ai'

function sourceToInlineMdc(url: string): string {
	const domain = getDomain(url)
	const favicon = getFaviconUrl(url)
	return ` :source-link{url="${url.replace(/"/g, '&quot;')}" favicon="${favicon.replace(/"/g, '&quot;')}" label="${domain}"}`
}

/**
 * Joins adjacent text parts and turns each citation into an inline link after the text it follows.
 * Both platforms send citations as `source-url` parts; OpenRouter repeats URLs, so each URL shows once.
 */
export function getMergedParts(parts: UIMessage['parts']): UIMessage['parts'] {
	const result: UIMessage['parts'] = []
	const seen: Record<string, true> = {}
	for (const part of parts) {
		const prev = result[result.length - 1]
		if (part.type === 'source-url') {
			if (prev && isTextUIPart(prev) && !seen[part.url]) {
				seen[part.url] = true
				result[result.length - 1] = { type: 'text', text: prev.text + sourceToInlineMdc(part.url) }
			}
			continue
		}
		if (isTextUIPart(part) && prev && isTextUIPart(prev)) {
			result[result.length - 1] = { type: 'text', text: prev.text + part.text }
		}
		else {
			result.push(part)
		}
	}
	return result
}
