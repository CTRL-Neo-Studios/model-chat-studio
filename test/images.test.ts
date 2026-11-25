import { expect, test } from 'bun:test'
import type { UIMessage } from 'ai'
import { imagesForModel, imageTool, type MadeImage } from '../server/utils/chat/imageTool'

const made = (prompt: string): MadeImage => ({ fileId: `f-${prompt}`, url: `/api/v1/files/f-${prompt}`, mediaType: 'image/webp', prompt })
const run = (tool: ReturnType<typeof imageTool>, prompt: string) => tool.execute!({ prompt }, { toolCallId: prompt, messages: [] }) as Promise<MadeImage>

test('draws at most 4 images in one answer, and 10 a minute per member', async () => {
	const answer = imageTool({ userId: 'u1', make: async prompt => made(prompt) })
	for (const n of [1, 2, 3, 4]) expect((await run(answer, `a${n}`)).fileId).toBe(`f-a${n}`)
	await expect(run(answer, 'a5')).rejects.toThrow('At most 4 images')

	// The next answers share the member's minute: 6 more, then the limit.
	const next = imageTool({ userId: 'u1', make: async prompt => made(prompt) })
	const third = imageTool({ userId: 'u1', make: async prompt => made(prompt) })
	for (const n of [1, 2, 3, 4]) await run(next, `b${n}`)
	await run(third, 'c1')
	await run(third, 'c2')
	await expect(run(third, 'c3')).rejects.toThrow('Too many images')
	// Another member has their own allowance.
	expect((await run(imageTool({ userId: 'u2', make: async prompt => made(prompt) }), 'd1')).fileId).toBe('f-d1')
})

const drawn = (id: string, prompt: string): UIMessage => ({
	id,
	role: 'assistant',
	parts: [
		{ type: 'text', text: 'Here it is.' },
		{ type: 'tool-generate_image', toolCallId: `call-${id}`, state: 'output-available', input: { prompt }, output: made(prompt) },
	],
})
const failed: UIMessage = {
	id: 'a0',
	role: 'assistant',
	parts: [{ type: 'tool-generate_image', toolCallId: 'call-a0', state: 'output-error', input: { prompt: 'x' }, errorText: 'no' }, { type: 'text', text: 'Sorry.' }],
}
const question = (id: string): UIMessage => ({ id, role: 'user', parts: [{ type: 'text', text: 'Draw.' }] })

test('later turns carry drawn images as text; a model that reads images sees only the latest again', () => {
	const thread = [question('q0'), failed, question('q1'), drawn('a1', 'a cat'), question('q2'), drawn('a2', 'a dog'), question('q3')]

	const blind = imagesForModel(thread, false)
	expect(blind.map(message => message.id)).toEqual(['q0', 'a0', 'q1', 'a1', 'q2', 'a2', 'q3'])
	expect(blind[1]!.parts).toEqual([{ type: 'text', text: 'Sorry.' }])
	expect(blind[3]!.parts).toEqual([{ type: 'text', text: 'Here it is.' }, { type: 'text', text: '[image: a cat]' }])

	const seeing = imagesForModel(thread, true)
	expect(seeing.map(message => message.id)).toEqual(['q0', 'a0', 'q1', 'a1', 'q2', 'a2', 'a2-image', 'q3'])
	expect(seeing[6]).toMatchObject({ role: 'user', parts: [{ type: 'text' }, { type: 'file', url: '/api/v1/files/f-a dog', mediaType: 'image/webp' }] })
	// The answers themselves are unchanged.
	expect(thread[5]!.parts[1]!.type).toBe('tool-generate_image')
})
