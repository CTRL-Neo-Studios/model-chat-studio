import { randomUUID } from 'node:crypto'
import { schema } from 'hub:db'
import { blob } from '#server/utils/core/blob'
import { getInstanceSettings, type Db } from '#server/utils/core/settings'
import { platformInference } from '#server/utils/inference'
import { openrouterImage } from '#server/utils/inference/openrouter'
import { assertWithinBudget, monthlyBudgetStatus } from '#server/utils/chat/turns'
import type { MadeImage } from '#server/utils/chat/imageTool'
import type { User } from '#shared/types/db'

/**
 * Drawing for this member: the image model the admin chose and the stored OpenRouter key (the member's own, else
 * the instance's), whichever platform answers, as the decision model does. `null` while either is missing.
 */
export async function imageSetup(db: Db, userId: string) {
	const model = (await getInstanceSettings(db)).values['inference.openrouter'].imageModel
	if (!model) return null
	const openrouter = await platformInference(db, userId, 'openrouter')
	return openrouter ? { openrouter, model } : null
}

export type ImageSetup = NonNullable<Awaited<ReturnType<typeof imageSetup>>>

/**
 * Draws one image for a chat and keeps it (plan section 2): the budget checked first (on the instance key), the
 * OpenRouter call, the image stored as a file of the chat (linked to its answer when the answer is saved), and a
 * usage row of kind `image` with the cost the response reports.
 */
export async function makeImage(db: Db, input: { user: User, chatId: string, prompt: string, aspectRatio?: string, setup: ImageSetup }): Promise<MadeImage> {
	const { user, chatId, prompt, setup } = input
	assertWithinBudget(await monthlyBudgetStatus(db, user), setup.openrouter.byok)
	const { bytes, mediaType, costUsd } = await openrouterImage({ apiKey: setup.openrouter.apiKey, model: setup.model, prompt, aspectRatio: input.aspectRatio })
	const id = randomUUID()
	const extension = (mediaType.split('/')[1] ?? 'png').replace('+xml', '')
	const blobPath = `${user.id}/${chatId}/${id}.${extension}`
	await blob.put(blobPath, bytes, { contentType: mediaType })
	await db.insert(schema.file).values({ id, ownerId: user.id, chatId, blobPath, fileName: `image.${extension}`, mediaType, size: bytes.length })
	await db.insert(schema.usageEvent).values({ userId: user.id, chatId, kind: 'image', platform: 'openrouter', model: setup.model, byok: setup.openrouter.byok, costUsd })
	return { fileId: id, url: `/api/v1/files/${id}`, mediaType, prompt }
}
