import { createError, defineEventHandler, readValidatedBody } from 'nuxt/server'
import { db } from 'hub:db'
import { z } from 'zod'
import { getInstanceSettings } from '#server/utils/core/settings'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { assertRateLimit } from '#server/utils/core/rateLimit'
import { requireChat } from '#server/utils/chat/access'
import { listChatModels } from '#server/utils/chat/lanes'
import { charactersById } from '#server/utils/chat/characters'
import { listChatMessages } from '#server/utils/chat/turns'
import { shownThread } from '#server/utils/chat/thread'
import { decisionRequest, mentionedIds, orderSpeakers, readDecision, requestDecision, type Participant } from '#server/utils/chat/speakers'
import { getCatalog, platformInference, useInference } from '#server/utils/inference'
import { laneIdentity } from '#shared/utils/character'

const bodySchema = z.object({
	/** The message's text. */
	text: z.string().max(100_000),
	/** Participants picked with "@", by name, in the order written. */
	mentions: z.array(z.string().max(200)).max(24).default([]),
})

/**
 * Who answers the next round of a group chat, in order (plan section 1): "@" mentions, else the decision model, else
 * names in the text, else last round's speakers, else everyone. The client then asks them one after another.
 */
export default defineEventHandler(async (event) => {
	const [chat, { values: settings }] = await Promise.all([requireChat(event, 'manageChat'), getInstanceSettings(db)])
	if (chat.mode !== 'group') throw createError({ status: 400, statusText: 'Only a group chat chooses who answers' })
	const user = await useServerAuth().requireUser(event)
	const { text, mentions } = await readValidatedBody(event, bodySchema)
	assertRateLimit(`speakers:${user.id}`, 20, 60_000, 'messages')

	const [lanes, inference, messages] = await Promise.all([
		listChatModels(db, chat.id),
		useInference(db, user.id),
		listChatMessages(db, chat.id),
	])
	// The latest round anyone answered on the branch shown; the message being sent is not in it yet, or has no speakers.
	const last = shownThread(messages, chat.leafId).findLast(message => message.role === 'user' && message.metadata?.speakers?.length)
	const answering = lanes.filter(lane => lane.enabled).slice(0, settings.maxChatModels)
	const [characters, catalog] = await Promise.all([
		charactersById(db, answering.map(lane => lane.characterId)),
		inference ? getCatalog(db, inference).catch(() => []) : [],
	])
	const defaultModel = inference && catalog.find(model => model.id === inference.config.defaultModel)
	const participants: Participant[] = answering.map((lane) => {
		const character = lane.characterId ? characters[lane.characterId] : undefined
		const model = (lane.platform === inference?.platform.id ? catalog.find(item => item.id === lane.modelId) : undefined) ?? defaultModel
		const name = laneIdentity({ lane, character, modelName: model?.name ?? 'Model', userName: '' }).names.char
		return { id: lane.id, name, ...(character && lane.name && lane.name !== character.name && { alias: lane.name }) }
	})
	const lastSpeakers = last?.metadata?.speakers ?? []

	// The decision model, unless "@" already decided: whenever an OpenRouter key is stored, whichever platform answers.
	const decisionModel = settings['inference.openrouter'].decisionModel
	const openrouter = !mentionedIds(participants, mentions).length && decisionModel && participants.length > 1
		? await platformInference(db, user.id, 'openrouter')
		: null
	let decided: string[] | null = null
	if (openrouter && decisionModel) {
		try {
			const decision = await requestDecision(openrouter.apiKey, decisionRequest({ model: decisionModel, participants, lastSpeakers, text }))
			decided = readDecision(decision.answers, participants)
			await db.insert(schema.usageEvent).values({
				userId: user.id, chatId: chat.id, kind: 'decision', platform: 'openrouter', model: decisionModel, byok: openrouter.byok,
				provider: decision.provider, inputTokens: decision.usage?.input_tokens, outputTokens: decision.usage?.output_tokens, costUsd: decision.usage?.cost ?? null,
			})
		}
		catch (error) {
			// Failed or slower than 5 s: the names in the message decide.
			console.warn('[chat] the decision model did not decide', error)
		}
	}
	return orderSpeakers({ participants, mentions, decided, text, lastSpeakers })
})
