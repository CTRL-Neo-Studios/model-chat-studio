import { z } from 'zod'
// Relative, not `#shared`, so this module also loads in `bun test`.
import { CHAT_FILE_FORMAT, CHAT_FILE_VERSION, type ChatFile, type ChatFileMessage } from '../../../../shared/utils/chatFile'
import { modelParamsSchema } from '../../../../shared/utils/chat'

/**
 * OpenRouter's Chatroom export (`version: "orpg.…"`, spike N in the milestone 12 plan) made into a chat file, which
 * the import then checks and writes like any other. Only the fields read here are described; the rest of the export
 * (router and plugin details, artifacts) is ignored.
 */
const contentSchema = z.looseObject({ type: z.string(), text: z.string().optional(), image_url: z.string().optional(), file_data: z.string().optional(), filename: z.string().optional(), annotations: z.array(z.looseObject({ type: z.string(), url: z.string().optional(), title: z.string().optional() })).optional() })
const itemSchema = z.looseObject({
	messageId: z.string(),
	data: z.looseObject({
		type: z.string(),
		status: z.string().optional(),
		content: z.union([z.array(contentSchema), z.string()]).optional(),
		url: z.string().optional(),
		title: z.string().optional(),
		action: z.looseObject({ commands: z.array(z.string()).optional(), sources: z.array(z.looseObject({ url: z.string().optional() })).optional() }).optional(),
		output: z.array(z.looseObject({ stdout: z.string().optional(), stderr: z.string().optional() })).optional(),
	}),
})
export const openrouterExportSchema = z.looseObject({
	version: z.string().startsWith('orpg.'),
	title: z.string().optional(),
	characters: z.record(z.string(), z.looseObject({
		model: z.string(),
		modelInfo: z.looseObject({ name: z.string().optional(), short_name: z.string().optional() }).optional(),
		description: z.string().optional(),
		samplingParameters: z.record(z.string(), z.unknown()).optional(),
		isDisabled: z.boolean().optional(),
		isRemoved: z.boolean().optional(),
		createdAt: z.string().optional(),
	})),
	messages: z.record(z.string(), z.looseObject({
		id: z.string(),
		type: z.enum(['user', 'assistant']),
		characterId: z.string(),
		parentMessageId: z.string().optional(),
		createdAt: z.string(),
		isEdited: z.boolean().optional(),
		items: z.array(z.looseObject({ id: z.string(), outputIndex: z.number().optional(), sequenceIndex: z.number().optional() })),
		metadata: z.looseObject({ cost: z.string().optional(), tokensCount: z.number().optional(), variantSlug: z.string().optional(), requestedModel: z.string().optional() }).optional(),
	})),
	items: z.record(z.string(), itemSchema),
})

/** Whether a JSON file is a Chatroom export, by its version and its two maps. */
export function isOpenrouterExport(json: unknown) {
	const value = json as { version?: unknown, messages?: unknown, items?: unknown } | null
	return typeof value?.version === 'string' && value.version.startsWith('orpg.') && typeof value.messages === 'object' && typeof value.items === 'object'
}

// The Chatroom's sampling settings by their API names; a lane's here.
const SAMPLING: Record<string, keyof z.infer<typeof modelParamsSchema>> = {
	temperature: 'temperature', top_p: 'topP', top_k: 'topK', min_p: 'minP', top_a: 'topA', frequency_penalty: 'frequencyPenalty',
	presence_penalty: 'presencePenalty', repetition_penalty: 'repetitionPenalty', max_tokens: 'maxOutputTokens',
}

/**
 * The export as a chat file (spike N's mapping): each model a lane; the user's messages in the order sent, each
 * after the one before; each answer under its message in its model's lane, the newest showing where a model answered
 * one message more than once. Reasoning, text and sources (citations, web searches and fetches) come as parts, shell
 * calls as code blocks in the text; images and files as attachments. Returns the file and what it left out.
 */
export function openrouterToChatFile(json: unknown): { file: ChatFile, notes: string[] } {
	const parsed = openrouterExportSchema.safeParse(json)
	if (!parsed.success) throw new Error(`This OpenRouter export is not one this app reads: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`)
	const exported = parsed.data
	const left: Record<string, number> = {}
	const leave = (what: string) => left[what] = (left[what] ?? 0) + 1
	const attachments: ChatFile['attachments'] = []

	const characters = Object.entries(exported.characters).toSorted(([, a], [, b]) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
	const lanes: ChatFile['lanes'] = characters.map(([id, character], position) => {
		const params = modelParamsSchema.safeParse(Object.fromEntries(Object.entries(character.samplingParameters ?? {}).flatMap(([key, value]) => SAMPLING[key] ? [[SAMPLING[key], value]] : [])))
		return {
			id,
			position,
			enabled: !character.isDisabled && !character.isRemoved,
			name: (character.modelInfo?.short_name ?? character.modelInfo?.name ?? character.model).slice(0, 60),
			color: null,
			platform: 'openrouter',
			modelId: character.model,
			systemPrompt: character.description?.trim() || null,
			params: params.success ? params.data : {},
			character: null,
		}
	})
	const laneNames = Object.fromEntries(lanes.map(lane => [lane.id, lane.name]))
	type Part = ChatFileMessage['parts'][number]

	/** An image or file of a user's message, kept as an attachment when it is a base64 data URL. */
	const attach = (dataUrl: string, name: string): Part[] => {
		const match = /^data:([\w.+-]+\/[\w.+-]+);base64,(.*)$/s.exec(dataUrl)
		if (!match) {
			leave('an image or file that was not inside the export')
			return []
		}
		// A file id, as message parts name files (`FILE_URL_PATTERN`); the import gives it another.
		const id = crypto.randomUUID()
		attachments.push({ id, name, mediaType: match[1]!, size: Buffer.byteLength(match[2]!, 'base64'), data: match[2]! })
		return [{ type: 'file', mediaType: match[1]!, url: `/api/v1/files/${id}`, filename: name }]
	}

	const messages = Object.values(exported.messages).toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
	const users: Record<string, true> = {}
	let lastUser: string | null = null
	const file: ChatFileMessage[] = []
	for (const message of messages) {
		const refs = message.items.toSorted((a, b) => (a.outputIndex ?? 0) - (b.outputIndex ?? 0) || (a.sequenceIndex ?? 0) - (b.sequenceIndex ?? 0))
		const items = refs.flatMap(ref => exported.items[ref.id] ? [exported.items[ref.id]!.data] : [])
		if (message.type === 'user') {
			const parts = items.flatMap((item): Part[] => {
				if (item.type !== 'message' || !Array.isArray(item.content)) {
					leave(`an item of a kind not imported (${item.type.slice(0, 40)})`)
					return []
				}
				return item.content.flatMap((part, index): Part[] => {
					if (part.type === 'input_text' && part.text) return [{ type: 'text', text: part.text }]
					if (part.type === 'input_image' && part.image_url) return attach(part.image_url, `image-${attachments.length + 1}.${part.image_url.slice(11, part.image_url.indexOf(';')) || 'png'}`)
					if (part.type === 'input_file' && part.file_data) return attach(part.file_data, part.filename ?? `file-${index + 1}`)
					leave(`a part of a kind not imported (${part.type.slice(0, 40)})`)
					return []
				})
			})
			file.push({ id: message.id, role: 'user', parentId: lastUser, laneId: null, active: true, author: null, parts, metadata: null, createdAt: new Date(message.createdAt).toISOString() })
			users[message.id] = true
			lastUser = message.id
			continue
		}
		if (!message.parentMessageId || !users[message.parentMessageId] || !laneNames[message.characterId]) {
			leave('an answer to no message of the export')
			continue
		}
		const sources: string[] = []
		const source = (url?: string, title?: string): Part[] => url && !sources.includes(url) ? (sources.push(url), [{ type: 'source-url', sourceId: url, url, ...(title && { title }) }]) : []
		const parts = items.flatMap((item): Part[] => {
			const content = Array.isArray(item.content) ? item.content : []
			if (item.type === 'reasoning') {
				const text = content.flatMap(part => part.type === 'reasoning_text' && part.text ? [part.text] : []).join('\n\n')
				if (!text) leave('reasoning that was sent encrypted')
				return text ? [{ type: 'reasoning', text }] : []
			}
			if (item.type === 'message') {
				return content.flatMap(part => part.type === 'output_text'
					? [{ type: 'text', text: part.text ?? '' }, ...(part.annotations ?? []).flatMap(note => note.type === 'url_citation' ? source(note.url, note.title) : [])]
					: [])
			}
			if (item.type === 'openrouter:web_search') return (item.action?.sources ?? []).flatMap(entry => source(entry.url))
			if (item.type === 'openrouter:web_fetch') return source(item.url, item.title)
			if (item.type === 'openrouter:shell') {
				// As text, not a tool call: the app runs no shell, and a call without its result (a stopped answer) would
				// make the next request one no provider takes.
				const runs = item.output ?? []
				const lines = (item.action?.commands ?? []).flatMap((command, index) => [`$ ${command}`, runs[index]?.stdout?.trimEnd(), runs[index]?.stderr?.trimEnd()].filter(line => !!line))
				if (item.status !== 'completed') lines.push('# stopped before it finished')
				const body = lines.join('\n')
				const fence = '`'.repeat(Math.max(3, ...[...body.matchAll(/`+/g)].map(run => run[0].length + 1)))
				return [{ type: 'text', text: `${fence}shell\n${body}\n${fence}` }]
			}
			leave(`an item of a kind not imported (${item.type.slice(0, 40)})`)
			return []
		})
		const cost = Number(message.metadata?.cost)
		file.push({
			id: message.id,
			role: 'assistant',
			parentId: message.parentMessageId,
			laneId: message.characterId,
			// The import shows the newest of a lane's answers to a message.
			active: false,
			author: null,
			parts,
			metadata: {
				platform: 'openrouter',
				model: message.metadata?.variantSlug ?? message.metadata?.requestedModel ?? exported.characters[message.characterId]!.model,
				lane: { name: laneNames[message.characterId], color: null },
				...(Number.isFinite(cost) && { costUsd: cost }),
				...(message.metadata?.tokensCount !== undefined && { outputTokens: message.metadata.tokensCount }),
				...(message.isEdited && { edited: true }),
			},
			createdAt: new Date(message.createdAt).toISOString(),
		})
	}

	return {
		file: {
			format: CHAT_FILE_FORMAT,
			version: CHAT_FILE_VERSION,
			exportedAt: new Date().toISOString(),
			chat: { title: exported.title?.trim().slice(0, 200) || null, mode: 'separate', settings: {}, userCharacter: null, structureProfile: null, libraries: [] },
			lanes,
			messages: file,
			tipId: lastUser,
			votes: [],
			attachments,
		},
		notes: Object.entries(left).map(([what, count]) => `${what} was left out${count > 1 ? ` (${count} times)` : ''}`),
	}
}
