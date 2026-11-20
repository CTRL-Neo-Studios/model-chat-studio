// Synthetic streams built from the platforms' docs (phase P, branch `prep/spikes`, scripts/spikes/*).

export function sseResponse(chunks: unknown[]): Response {
	const body = chunks.map(chunk => `data: ${typeof chunk === 'string' ? chunk : JSON.stringify(chunk)}\n\n`).join('')
	return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

// OpenRouter Chat Completions, with a citation, reasoning and the usage chunk OpenRouter always sends.
const openrouterBase = { id: 'gen-123', object: 'chat.completion.chunk', created: 1763600000, model: 'deepseek/deepseek-chat', provider: 'DeepInfra' }
/** `cost: null` leaves the cost out of the usage chunk. */
export const openrouterChunks = (cost: number | null = 0.000123) => [
	{ ...openrouterBase, choices: [{ index: 0, delta: { role: 'assistant', content: '', reasoning: 'Let me search.', reasoning_details: [{ type: 'reasoning.text', text: 'Let me search.', format: 'unknown', index: 0 }] } }] },
	{ ...openrouterBase, choices: [{ index: 0, delta: { content: 'Nuxt 4.6 shipped.' } }] },
	{ ...openrouterBase, choices: [{ index: 0, delta: { annotations: [{ type: 'url_citation', url_citation: { url: 'https://nuxt.com/blog/v4-6', title: 'Nuxt 4.6', content: 'Nuxt 4.6 is out', start_index: 0, end_index: 16 } }] } }] },
	{ ...openrouterBase, choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }] },
	{ ...openrouterBase, choices: [], usage: { prompt_tokens: 194, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 5 }, total_tokens: 214, ...(cost !== null && { cost }) } },
	'[DONE]',
]

// DeepSeek Chat Completions: thinking, a web search, a citation and a title on the last chunk.
const deepseekChunk = (choice: Record<string, unknown>, usage: unknown = null) => ({
	id: '071f229d-0001', object: 'chat.completion.chunk', created: 1793084907, model: 'deepseek-flash',
	choices: [{ index: 0, logprobs: null, finish_reason: null, ...choice }], usage,
})
export const deepseekChunks = [
	deepseekChunk({ delta: { role: 'assistant', content: '', reasoning_content: '' } }),
	deepseekChunk({ delta: { reasoning_content: 'Need to search for V4.1.' } }),
	deepseekChunk({ delta: { content: 'DeepSeek V4.1 adds faster Flash.' } }),
	deepseekChunk({
		delta: {
			content: '',
			annotations: [{ type: 'url_citation', url_citation: { url: 'https://api-docs.deepseek.com/news/news261017/', title: 'DeepSeek V4.1 release', start_index: 0, end_index: 31 } }],
			title: 'DeepSeek V4.1 changes',
		},
		finish_reason: 'stop',
	}, {
		prompt_tokens: 13174, completion_tokens: 1686, total_tokens: 14860,
		prompt_tokens_details: { cached_tokens: 4096 }, prompt_cache_hit_tokens: 4096, prompt_cache_miss_tokens: 9078,
		completion_tokens_details: { reasoning_tokens: 900 },
	}),
	'[DONE]',
]
