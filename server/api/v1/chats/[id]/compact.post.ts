import { createError, defineEventHandler } from 'nuxt/server'
import { convertToModelMessages, generateId, generateText, type UIMessage } from 'ai'
import { db, schema } from 'hub:db'
import type { MessageMetadata } from '#shared/utils/chat'
import { getInstanceSettings } from '#server/utils/core/settings'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { assertRateLimit } from '#server/utils/core/rateLimit'
import { requireChat } from '#server/utils/chat/access'
import { buildContext } from '#server/utils/chat/context'
import { resolveAttachments } from '#server/utils/chat/files'
import { expandReferences } from '#server/utils/library/references'
import { chatLibraries } from '#server/utils/library/libraries'
import { listChatModels } from '#server/utils/chat/lanes'
import { assertWithinBudget, chatTip, listChatMessages, monthlyBudgetStatus } from '#server/utils/chat/turns'
import { shownThread } from '#server/utils/chat/thread'
import { getCatalog, getPriceOverride, useInference } from '#server/utils/inference'
import { groupThread } from '#server/utils/chat/group'
import { charactersById } from '#server/utils/chat/characters'

const COMPACT_INSTRUCTIONS = `You write a summary of a conversation for yourself, so you can continue it later without the full history.
- Keep the facts, decisions, names, numbers, code, open questions and the user's preferences and goals
- Keep what you were asked to do and what you answered, briefly
- Plain prose or short lists, no preamble, in the conversation's language`

/**
 * `/compact`: each answering lane summarises its own thread with its own model, on the branch shown. The summary is
 * stored as a `system` message of that lane after the branch's tip; from then on the lane is sent the summary and what
 * follows it. In a group chat the first lane summarises the shared thread once, and every lane reads that summary.
 * Summarised messages stay in the chat, readable, above a divider. Billed as `compact`.
 */
export default defineEventHandler(async (event) => {
	const [chat, { values: settings }] = await Promise.all([requireChat(event, 'manageChat'), getInstanceSettings(db)])
	const user = await useServerAuth().requireUser(event)
	assertRateLimit(`turn:${user.id}`, 20, 60_000, 'messages')

	const [inference, lanes, budget] = await Promise.all([useInference(db, user.id), listChatModels(db, chat.id), monthlyBudgetStatus(db, user)])
	if (!inference) throw createError({ status: 503, statusText: 'No model platform is configured yet. An admin can set one up in the settings.' })
	const { platform, apiKey, byok, config } = inference
	assertWithinBudget(budget, byok)
	const catalog = await getCatalog(db, inference)
	const libraries = (await chatLibraries(db, chat.id)).map(({ id, name }) => ({ id, name }))

	// In a group chat one summary of the shared thread, written by the first lane's model, which every lane reads.
	const group = chat.mode === 'group'
	const answering = lanes.filter(lane => lane.enabled).slice(0, settings.maxChatModels)
	const userName = (chat.userCharacterId && (await charactersById(db, [chat.userCharacterId]))[chat.userCharacterId]?.name) || user.name || user.username
	// The branch shown; a summary belongs to its tip, so a branch that leaves earlier does not get it.
	const tip = await chatTip(db, chat.id)
	const results = await Promise.allSettled((group ? answering.slice(0, 1) : answering).map(async (lane) => {
		const shown = shownThread(await listChatMessages(db, chat.id, group ? undefined : lane.id), tip)
		const thread = group
			? groupThread(shown as UIMessage<MessageMetadata>[], { laneId: lane.id, userName })
			: shown as UIMessage[]
		const context = buildContext({ thread, systemPrompt: lane.systemPrompt, webSearch: false, memoryLength: null })
		// Nothing new since the lane's last summary.
		if (!context.blocks.some(block => block.kind === 'message')) return null

		const chosen = lane.platform === platform.id ? catalog.find(model => model.id === lane.modelId) : undefined
		const model = chosen ?? catalog.find(model => model.id === config.defaultModel)
		if (!model) throw new Error('This chat\'s model is not available')
		const prepared = platform.prepare({ apiKey, model: model.id, userId: user.id, firstTurn: false, safetyCheck: settings.safetyCheck })
		const { messages } = await expandReferences(db, libraries, context.messages, [])
		const history = await resolveAttachments({ db, inference, model, userId: user.id, chatId: chat.id, libraryIds: libraries.map(library => library.id) }, messages)
		const result = await generateText({
			model: prepared.model,
			providerOptions: prepared.providerOptions,
			instructions: group ? `${COMPACT_INSTRUCTIONS}\n- This is a group chat: say who said what; your own answers are the assistant's` : COMPACT_INSTRUCTIONS,
			messages: [...await convertToModelMessages(history), { role: 'user', content: 'Summarize our conversation so far, as instructed.' }],
			maxRetries: settings.maxRetries,
		})

		const price = await getPriceOverride(db, platform.id, model.id)
		const { title: _, ...usage } = platform.usage({ model: model.id, steps: result.steps, price })
		await db.insert(schema.usageEvent).values({
			userId: user.id, chatId: chat.id, kind: 'compact', platform: platform.id, model: model.id, byok,
			provider: usage.provider, inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens,
			outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens, costUsd: usage.costUsd,
		})
		const text = result.text.trim()
		if (!text) throw new Error('The model returned an empty summary')
		const metadata: MessageMetadata = { kind: 'summary', platform: platform.id, model: model.id, lane: { name: lane.name ?? model.name, color: lane.color }, ...usage }
		const [summary] = await db.insert(schema.message)
			.values({ id: generateId(), chatId: chat.id, role: 'system', parts: [{ type: 'text', text }], chatModelId: lane.id, metadata, parentId: tip })
			.returning({ id: schema.message.id, role: schema.message.role, parts: schema.message.parts, metadata: schema.message.metadata, chatModelId: schema.message.chatModelId, parentId: schema.message.parentId, createdAt: schema.message.createdAt })
		return summary!
	}))

	const summaries = results.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : [])
	const failed = results.filter(result => result.status === 'rejected')
	for (const failure of failed) console.error('[chat] compact failed', failure.reason)
	if (failed.length && !summaries.length) throw createError({ status: 502, statusText: 'The chat could not be compacted. Try again.' })
	return { summaries, failed: failed.length }
})
