import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'
// Relative, not `#shared` or `hub:db`, so this module also loads in `bun test`.
import * as tables from '../../db/schema'
import type { Db } from '../core/settings'
import { CHAT_FILE_FORMAT, CHAT_FILE_VERSION, type ChatFile, type ChatFileMessage } from '../../../shared/utils/chatFile'
import { chatAuthors } from './turns'
import { shownThread } from './thread'

/**
 * A chat as a chat file (milestone 12 plan, section 1): the whole chat, every branch and version, with its lanes'
 * Characters as text at this moment. With `readFile`, attachments carry their bytes; without, their names only.
 */
export async function exportChat(db: Db, chatId: string, readFile?: (blobPath: string) => Promise<Uint8Array | null>): Promise<ChatFile> {
	const [chat] = await db.select().from(tables.chat).where(eq(tables.chat.id, chatId))
	if (!chat) throw new Error(`No chat ${chatId}`)
	const [lanes, messages, votes, files, libraries, [profile]] = await Promise.all([
		db.select().from(tables.chatModel).where(eq(tables.chatModel.chatId, chatId)).orderBy(asc(tables.chatModel.position)),
		db.select().from(tables.message).where(eq(tables.message.chatId, chatId)).orderBy(asc(tables.message.seq)),
		db.select().from(tables.vote).where(eq(tables.vote.chatId, chatId)),
		// The files of its messages: attachments, and images drawn for it.
		db.select().from(tables.file).where(and(eq(tables.file.chatId, chatId), isNotNull(tables.file.messageId))),
		db.select({ name: tables.library.name }).from(tables.chatLibrary)
			.innerJoin(tables.library, eq(tables.library.id, tables.chatLibrary.libraryId))
			.where(eq(tables.chatLibrary.chatId, chatId)).orderBy(asc(tables.chatLibrary.createdAt)),
		chat.structureProfileId ? db.select({ name: tables.structureProfile.name, blocks: tables.structureProfile.blocks }).from(tables.structureProfile).where(eq(tables.structureProfile.id, chat.structureProfileId)) : [],
	])
	const characterIds = [...new Set([...lanes.map(lane => lane.characterId), chat.userCharacterId].filter(id => id !== null))]
	const [characters, authors] = await Promise.all([
		characterIds.length ? db.select().from(tables.character).where(inArray(tables.character.id, characterIds)) : [],
		chatAuthors(db, messages),
	])
	const asText = (id: string | null) => {
		const character = characters.find(entry => entry.id === id)
		return character ? { name: character.name, instructions: character.instructions, examples: character.examples, note: character.note } : null
	}

	return {
		format: CHAT_FILE_FORMAT,
		version: CHAT_FILE_VERSION,
		exportedAt: new Date().toISOString(),
		chat: {
			title: chat.title,
			mode: chat.mode,
			settings: chat.settings,
			userCharacter: asText(chat.userCharacterId),
			structureProfile: profile ? { name: profile.name, blocks: profile.blocks } : null,
			libraries: libraries.map(library => library.name),
		},
		lanes: lanes.map(lane => ({
			id: lane.id, position: lane.position, enabled: lane.enabled, name: lane.name, color: lane.color, platform: lane.platform,
			modelId: lane.modelId, systemPrompt: lane.systemPrompt, params: lane.params, character: asText(lane.characterId),
		})),
		messages: messages.map(message => ({
			id: message.id,
			role: message.role,
			parentId: message.parentId,
			laneId: message.chatModelId,
			active: message.active,
			author: message.role === 'user' && message.userId ? authors[message.userId]?.name ?? null : null,
			parts: message.parts as ChatFileMessage['parts'],
			metadata: (message.metadata ?? null) as ChatFileMessage['metadata'],
			createdAt: message.createdAt.toISOString(),
		})),
		tipId: chat.leafId,
		votes: votes.map(vote => ({ messageId: vote.messageId, isUpvoted: vote.isUpvoted })),
		attachments: await Promise.all(files.map(async (file) => {
			const bytes = readFile && await readFile(file.blobPath)
			return { id: file.id, name: file.fileName, mediaType: file.mediaType, size: file.size, ...(bytes && { data: Buffer.from(bytes).toString('base64') }) }
		})),
	}
}

type Part = ChatFileMessage['parts'][number] & { text?: string, filename?: string, mediaType?: string, url?: string, title?: string, input?: { title?: string, prompt?: string }, output?: { prompt?: string }, data?: { name?: string } }

/** One message's parts as Markdown: reasoning folded away, attachments and drawings by name, sources listed after. */
function partsMarkdown(parts: Part[]) {
	const sources: string[] = []
	const blocks = parts.flatMap((part) => {
		if (part.type === 'text') return part.text?.trim() ? [part.text.trim()] : []
		if (part.type === 'reasoning') return part.text?.trim() ? [`<details>\n<summary>Reasoning</summary>\n\n${part.text.trim()}\n\n</details>`] : []
		if (part.type === 'file') return [`*Attachment: ${part.filename ?? part.mediaType ?? 'file'}*`]
		if (part.type === 'data-reference') return [`*Library: ${part.data?.name ?? 'a file'}*`]
		if (part.type === 'source-url') {
			if (part.url && !sources.includes(part.url)) sources.push(part.url)
			return []
		}
		if (part.type === 'tool-chart') return [`*Chart: ${part.input?.title ?? 'untitled'}*`]
		if (part.type === 'tool-generate_image') return [`*Image: ${part.output?.prompt ?? part.input?.prompt ?? 'drawn'}*`]
		if (part.type.startsWith('tool-')) return [`*Used ${part.type.slice(5)}*`]
		return []
	})
	if (sources.length) blocks.push(`Sources:\n${sources.map(url => `- <${url}>`).join('\n')}`)
	return blocks.join('\n\n')
}

/**
 * The branch that shows, as a document to read (milestone 12 plan, section 1): a heading per message with who wrote
 * it, each user message followed by its answers as the page shows them (a group round in speaking order, else lane
 * order). Not meant to be read back in.
 */
export function chatMarkdown(file: ChatFile) {
	const thread = shownThread(file.messages.filter(message => message.role !== 'assistant' || message.active), file.tipId)
	const lanes = Object.fromEntries(file.lanes.map(lane => [lane.id, lane]))
	const laneName = (message: ChatFileMessage) => {
		const recorded = message.metadata as { lane?: { name?: string }, model?: string } | null
		const lane = message.laneId ? lanes[message.laneId] : undefined
		const name = recorded?.lane?.name ?? lane?.name ?? recorded?.model ?? 'Model'
		return recorded?.model && recorded.model !== name ? `${name} · ${recorded.model}` : name
	}
	const answersTo = (question: ChatFileMessage) => {
		const speakers = (question.metadata as { speakers?: string[] } | null)?.speakers ?? []
		const place = (answer: ChatFileMessage) => {
			const spoke = speakers.indexOf(answer.laneId ?? '')
			return spoke !== -1 ? spoke : speakers.length + (answer.laneId ? lanes[answer.laneId]?.position ?? 0 : file.lanes.length)
		}
		return thread.filter(message => message.role === 'assistant' && message.parentId === question.id).toSorted((a, b) => place(a) - place(b))
	}
	const section = (heading: string, message: ChatFileMessage) => `## ${heading}\n\n${partsMarkdown(message.parts as Part[]) || '*(nothing)*'}`

	const sections = thread.flatMap((message) => {
		if (message.role === 'user') return [section(message.author ?? 'You', message), ...answersTo(message).map(answer => section(laneName(answer), answer))]
		// A greeting answers no message; the other answers come under their question.
		if (message.role === 'assistant') return message.parentId ? [] : [section(laneName(message), message)]
		return [section(file.chat.mode === 'group' ? 'Summary of the chat' : `Summary for ${laneName(message)}`, message)]
	})
	const models = file.lanes.map(lane => lane.name ?? lane.character?.name ?? lane.modelId ?? 'the default model').join(', ')
	return `# ${file.chat.title ?? 'Untitled chat'}\n\nExported ${file.exportedAt.slice(0, 10)}${models ? `, with ${models}` : ''}.\n\n${sections.join('\n\n')}\n`
}
