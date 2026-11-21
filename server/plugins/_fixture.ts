import { openrouterChunks, sseResponse } from '../../test/fixtures/sse'

// Throwaway: answers OpenRouter chat calls with a fixture stream and keeps what each call was sent. Delete after the check.
export const captured: { messages: { role: string, content: unknown }[] }[] = []

export default defineNitroPlugin(() => {
	const real = globalThis.fetch
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input instanceof Request ? input.url : input)
		if (url.startsWith('https://openrouter.ai/api/v1/chat/completions')) {
			captured.push(JSON.parse(String(init?.body)))
			return sseResponse(openrouterChunks())
		}
		return real(input, init)
	}) as typeof fetch
})
