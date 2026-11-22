import { createError, defineEventHandler, readValidatedBody } from 'nuxt/server'
import { convertToModelMessages, createUIMessageStreamResponse, generateId, generateText, isStepCount, smoothStream, streamText, toUIMessageStream, type TextStreamPart, type ToolSet, type UIMessage } from 'ai'
import { db, schema } from 'hub:db'
import { and, eq, isNull } from 'drizzle-orm'
import type { MessageMetadata } from '#shared/utils/chat'
import { chartTool } from '#shared/utils/tools/chart'
import { userPreferencesSchema } from '#shared/utils/preferences'
import { getInstanceSettings } from '#server/utils/core/settings'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { assertRateLimit } from '#server/utils/core/rateLimit'
import { requireChat } from '#server/utils/chat/access'
import { answerAttempt, applyTurnTrigger, assertWithinBudget, fallbackTitle, listChatMessages, monthlyBudgetStatus, saveAnswer, turnRequestSchema } from '#server/utils/chat/turns'
import { listChatModels } from '#server/utils/chat/lanes'
import { resolveAttachments } from '#server/utils/chat/files'
import { getCatalog, getEndpoints, getPriceOverride, useInference } from '#server/utils/inference'
import { buildContext } from '#server/utils/chat/context'
import type { FinishedStep, Pricing } from '#server/utils/inference/types'

const TITLE_INSTRUCTIONS = `Write a title for a chat that starts with the user's message below.
- Under 30 characters, summarizing the message
- Plain text: no quotes, colons, punctuation or Markdown`

const REFUSAL = 'This answer was withheld by the content safety check.'

/**
 * Streams one lane's answer. The client sends only the new message (or the regenerate target) and the lane,
 * never the history; the lane sees its own thread.
 */
export default defineEventHandler(async (event) => {
	// Reads run in a few parallel groups, each one database round trip, before the model is called.
	const [chat, { values: settings }] = await Promise.all([requireChat(event, 'manageChat'), getInstanceSettings(db)])
	const user = await useServerAuth().requireUser(event)
	const request = await readValidatedBody(event, turnRequestSchema)
	// Each answer costs money; a stuck client or script should not be able to run up the bill.
	assertRateLimit(`turn:${user.id}`, 20, 60_000, 'messages')
	const chatId = chat.id

	const startedAt = Date.now()
	const [inference, lanes, budget] = await Promise.all([useInference(db, user.id), listChatModels(db, chatId), monthlyBudgetStatus(db, user)])
	if (!inference) throw createError({ status: 503, statusText: 'No model platform is configured yet. An admin can set one up in the settings.' })
	const { platform, apiKey, byok, config } = inference

	const lane = lanes.find(lane => lane.id === request.chatModelId)
	if (!lane) throw createError({ status: 404, statusText: 'Model not found in this chat' })
	if (!lane.enabled) throw createError({ status: 400, statusText: 'This model is turned off in this chat' })
	// A limit lowered after the lanes were turned on: only the first ones answer.
	const { maxChatModels, maxRegenerations, maxRetries, safetyCheck } = settings
	if (lanes.filter(entry => entry.enabled).findIndex(entry => entry.id === lane.id) >= maxChatModels) {
		throw createError({ status: 400, statusText: `Only the first ${maxChatModels} models in a chat answer. Turn one off first.` })
	}

	// Policy checks: the allowlist, the provider list and the budget.
	const params = lane.params
	const catalog = await getCatalog(db, inference)
	const chosen = lane.platform === platform.id ? catalog.find(model => model.id === lane.modelId) : undefined
	// A model that is no longer offered (or another platform's) falls back to the default, without its model-specific settings.
	const model = chosen ?? catalog.find(model => model.id === config.defaultModel)
	if (!model) throw createError({ status: 400, statusText: 'This chat\'s model is not available. Pick another model.' })

	const providers = chosen && platform.capabilities.providerRouting && params.providers?.length ? params.providers : undefined
	if (providers) {
		const tags = (await getEndpoints(inference, model.id)).map(endpoint => endpoint.tag)
		if (providers.some(tag => !tags.includes(tag))) throw createError({ status: 400, statusText: 'A chosen provider does not serve this model' })
	}
	const levels = model.reasoning ? [...model.reasoningLevels, 'none', 'on'] : []
	const reasoningLevel = chosen && params.reasoningLevel && levels.includes(params.reasoningLevel) ? params.reasoningLevel : undefined

	assertWithinBudget(budget, byok)

	const parentId = await applyTurnTrigger(db, chatId, request)
	const [previousAttempt, thread] = await Promise.all([
		answerAttempt(db, lane.id, parentId),
		listChatMessages(db, chatId, lane.id) as Promise<UIMessage<MessageMetadata>[]>,
	])
	// Each regenerate is one more attempt at the lane's answer to this message; past the admin's cap it is refused.
	const attempt = previousAttempt + 1
	if (attempt > maxRegenerations + 1) {
		throw createError({ status: 429, statusText: `This answer was regenerated ${maxRegenerations === 1 ? 'once' : `${maxRegenerations} times`}, the most allowed.` })
	}
	// The lane's thread up to the message being answered: a regenerated answer does not see what came after.
	const history = thread.slice(0, thread.findIndex(message => message.id === parentId) + 1)
	const firstText = history.find(message => message.role === 'user')?.parts.map(part => part.type === 'text' ? part.text : '').join(' ') ?? ''

	// The first enabled lane names the chat, so a chat answered by several lanes is named once.
	// A temporary chat gets no title; "Keep this chat" names it from its first message.
	const firstTurn = !chat.temporary && !chat.title && lanes.find(lane => lane.enabled)?.id === lane.id
	/** Appends one row to the spend ledger and returns the usage. */
	const recordUsage = async (kind: 'chat' | 'title', modelId: string, steps: FinishedStep[], price: Pricing | null = null) => {
		const usage = platform.usage({ model: modelId, steps, price })
		await db.insert(schema.usageEvent).values({
			userId: user.id, chatId, kind, platform: platform.id, model: modelId, byok,
			provider: usage.provider, inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens,
			outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens, costUsd: usage.costUsd,
		})
		return usage
	}

	// On platforms without a native title, a separate call runs alongside the answer.
	const titleModel = firstTurn && !platform.capabilities.nativeTitle ? config.titleModel : undefined
	const titlePromise = titleModel
		? (async () => {
				const prepared = platform.prepare({ apiKey, model: titleModel, userId: user.id, firstTurn: false, safetyCheck })
				const result = await generateText({ model: prepared.model, providerOptions: prepared.providerOptions, instructions: TITLE_INSTRUCTIONS, prompt: firstText })
				await recordUsage('title', titleModel, result.steps)
				return result.text.trim() || undefined
			})().catch((error) => {
				console.error('[chat] title generation failed', error)
				return undefined
			})
		: Promise.resolve(undefined)

	const webSearch = !!chat.settings.webSearch && model.webSearch
	const context = buildContext({ thread: history, systemPrompt: lane.systemPrompt, webSearch, memoryLength: chat.settings.memoryLength ?? null })
	const prepared = platform.prepare({
		...params, apiKey, model: model.id, providers, reasoningLevel, webSearch,
		userId: user.id, firstTurn, safetyCheck,
	})
	const tools: ToolSet = prepared.appTools === false ? prepared.tools : { ...prepared.tools, chart: chartTool }
	const price = await getPriceOverride(db, platform.id, model.id)
	const modelHistory = await resolveAttachments({ db, inference, model, userId: user.id, chatId }, context.messages).catch((error) => {
		console.error('[chat] attachment failed', error)
		throw createError({ status: 502, statusText: `${platform.id} did not accept an attachment. Try again, or remove it.` })
	})

	const result = streamText({
		...prepared,
		tools,
		instructions: context.instructions,
		messages: await convertToModelMessages(modelHistory, { tools }),
		stopWhen: isStepCount(5),
		// Retries rate limits and server errors until the stream starts.
		maxRetries,
		abortSignal: event.req.signal,
		experimental_transform: smoothStream(),
	})

	// Usage is summed over finished steps, so an aborted turn still records what it used.
	const steps: FinishedStep[] = []
	const stream = result.stream.pipeThrough(new TransformStream<TextStreamPart<ToolSet>, TextStreamPart<ToolSet>>({
		transform(part, controller) {
			if (part.type === 'finish-step') steps.push(part)
			controller.enqueue(part)
		},
	}))
	// The lane as it is now, so the answer keeps its label after the lane is renamed or deleted.
	const laneLabel = { name: lane.name ?? model.name, color: lane.color }
	const metadata = (finishReason?: string): MessageMetadata => {
		const { title: _, ...usage } = platform.usage({ model: model.id, steps, price })
		return {
			platform: platform.id, model: model.id, lane: laneLabel, attempt, ...usage, durationMs: Date.now() - startedAt,
			...(finishReason === 'content-filter' && { refused: true }),
		}
	}

	return createUIMessageStreamResponse({
		stream: toUIMessageStream({
			stream,
			tools,
			sendSources: true,
			generateMessageId: generateId,
			messageMetadata: ({ part }) => part.type === 'start'
				? { platform: platform.id, model: model.id, lane: laneLabel }
				: part.type === 'finish' ? metadata(part.finishReason) : undefined,
			onError: (error) => {
				console.error('[chat] turn failed', error)
				return 'The model could not answer. Try again.'
			},
			// Runs before the response closes, so a client that refreshes on finish sees the title.
			onEnd: async ({ responseMessage, finishReason, isAborted }) => {
				try {
					const usage = await recordUsage('chat', model.id, steps, price)
					const stored = metadata(finishReason)
					const parts = stored.refused ? [{ type: 'text' as const, text: REFUSAL }] : responseMessage.parts
					// A stopped answer replaces the lane's earlier one unless the member chose to keep the earlier one.
					const keepPrevious = isAborted && userPreferencesSchema.parse(user.preferences).stoppedRegenerate === 'keep-previous'
					const saved = parts.length > 0
						&& await saveAnswer(db, { id: responseMessage.id, chatId, parentId, chatModelId: lane.id, parts, metadata: stored }, keepPrevious)
					// What the answer was given, for the conversation overview.
					if (saved) await db.insert(schema.turnTrace).values({ messageId: responseMessage.id, blocks: context.blocks })
					if (firstTurn) {
						const title = (await titlePromise) ?? usage.title ?? fallbackTitle(firstText)
						await db.update(schema.chat).set({ title }).where(and(eq(schema.chat.id, chatId), isNull(schema.chat.title)))
					}
				}
				catch (error) {
					console.error('[chat] saving the turn failed', error)
				}
			},
		}),
	})
})
