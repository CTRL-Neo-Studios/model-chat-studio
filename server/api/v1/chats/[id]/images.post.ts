import { createError, defineEventHandler, readValidatedBody } from 'nuxt/server'
import { db } from 'hub:db'
import { z } from 'zod'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { assertRateLimit } from '#server/utils/core/rateLimit'
import { requireChat } from '#server/utils/chat/access'
import { deleteStoredFiles } from '#server/utils/chat/files'
import { imageSetup, makeImage } from '#server/utils/chat/images'
import { IMAGE_ASPECT_RATIOS, IMAGES_PER_MINUTE } from '#server/utils/chat/imageTool'
import { saveImageExchange } from '#server/utils/chat/turns'

const bodySchema = z.object({
	prompt: z.string().trim().min(1).max(4000),
	aspectRatio: z.enum(IMAGE_ASPECT_RATIOS).optional(),
}).strict()

/**
 * `/image`: draws from the user's words, with no model turn. The exchange (the message and the image) joins the
 * chat at its tip; models are not sent it. Returns both messages, as the chat lists them.
 */
export default defineEventHandler(async (event) => {
	const chat = await requireChat(event, 'manageChat')
	const user = await useServerAuth().requireUser(event)
	const { prompt, aspectRatio } = await readValidatedBody(event, bodySchema)
	const setup = await imageSetup(db, user.id)
	if (!setup) throw createError({ status: 400, statusText: 'Images are not set up: an admin chooses an image model, and an OpenRouter key is needed.' })
	assertRateLimit(`image:${user.id}`, IMAGES_PER_MINUTE, 60_000, 'images')

	const image = await makeImage(db, { user, chatId: chat.id, prompt, aspectRatio, setup }).catch((error: unknown) => {
		// The budget's 402 as it is; a failed call as the platform's error.
		if (error && typeof error === 'object' && 'status' in error) throw error
		throw createError({ status: 502, statusText: error instanceof Error ? error.message : 'The image could not be drawn' })
	})
	try {
		return await saveImageExchange(db, { chatId: chat.id, prompt, aspectRatio, model: setup.model, image })
	}
	catch (error) {
		await deleteStoredFiles(db, [image.fileId], user.id)
		throw error
	}
})
