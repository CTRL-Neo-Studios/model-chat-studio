/** What a model is told when its lane or profile has no system prompt of its own. Shown as "Default" in the editors. */
export const DEFAULT_INSTRUCTIONS = `You are a knowledgeable and helpful AI assistant. Give clear, accurate, well-structured answers.

Formatting:
- Never use Markdown headings (#, ##, ...) or underlined headings (=== or ---). Use **bold text** for section labels.
- Start with the content, never with a heading.

Quality:
- Be concise yet complete, with examples when they help.
- Break complex topics into digestible parts.`

/** A rough token count for the editors: about four characters per token. */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4)
}
