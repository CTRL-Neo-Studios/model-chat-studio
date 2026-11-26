import { tool, type UIMessage } from 'ai'
import { z } from 'zod'
// Relative, not `#server`, so this module also loads in `bun test`.
import { assertRateLimit } from '../core/rateLimit'

/** The most images one answer may draw. */
export const MAX_IMAGES_PER_ANSWER = 4
/** The most images a member may have drawn in a minute, by the model or by `/image`. */
export const IMAGES_PER_MINUTE = 10
export const IMAGE_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] as const

/** An image drawn for a chat: its stored file, and the prompt it was drawn from. */
export interface MadeImage {
	fileId: string
	url: string
	mediaType: string
	prompt: string
}

/**
 * The `generate_image` tool of one answer (milestone 10 plan, section 1): the model decides when to draw. At most 4
 * images in the answer and 10 a minute per member; over either, the call fails and the model is told why. `make`
 * draws and stores one image. The model is told only that the image was made and shown (spike M).
 */
export function imageTool(input: { userId: string, make: (prompt: string, aspectRatio?: string) => Promise<MadeImage> }) {
	let drawn = 0
	return tool({
		description: 'Draw an image and show it to the user in the chat. Use it when the user asks for a picture, drawing, illustration or image. Describe the image in detail, in English.',
		inputSchema: z.object({
			prompt: z.string().min(1).max(4000).describe('A detailed description of the image to draw, in English.'),
			aspectRatio: z.enum(IMAGE_ASPECT_RATIOS).optional().describe('The image\'s shape; square when left out.'),
		}),
		execute: async ({ prompt, aspectRatio }) => {
			if (drawn >= MAX_IMAGES_PER_ANSWER) throw new Error(`At most ${MAX_IMAGES_PER_ANSWER} images can be drawn in one answer.`)
			assertRateLimit(`image:${input.userId}`, IMAGES_PER_MINUTE, 60_000, 'images')
			drawn++
			return await input.make(prompt, aspectRatio)
		},
		toModelOutput: () => ({ type: 'text', value: 'The image was made and shown to the user.' }),
	})
}

const SHOWN_AGAIN = 'The picture you drew in your last answer, shown again so you can see it:'

/**
 * What later turns carry in place of images a model drew (plan section 1, spike M). Each becomes a line of text,
 * "[image: the prompt]"; a call that drew nothing is left out. A model that reads images (`seesImages`) is also shown
 * the latest one again, in a user message right after the answer that drew it: given back inside its own answer, a
 * model does not see it.
 */
export function imagesForModel<T extends UIMessage>(thread: T[], seesImages: boolean): T[] {
	let latest: { index: number, image: MadeImage } | undefined
	const carried = thread.map((message, index) => {
		if (message.role !== 'assistant' || !message.parts.some(part => part.type === 'tool-generate_image')) return message
		const parts = message.parts.flatMap((part) => {
			if (part.type !== 'tool-generate_image') return [part]
			if (!('state' in part) || part.state !== 'output-available') return []
			const image = part.output as MadeImage
			latest = { index, image }
			return [{ type: 'text' as const, text: `[image: ${image.prompt}]` }]
		})
		return { ...message, parts }
	})
	if (!seesImages || !latest) return carried
	const shown = {
		id: `${thread[latest.index]!.id}-image`,
		role: 'user',
		parts: [{ type: 'text', text: SHOWN_AGAIN }, { type: 'file', url: latest.image.url, mediaType: latest.image.mediaType }],
	} as unknown as T
	return carried.toSpliced(latest.index + 1, 0, shown)
}
