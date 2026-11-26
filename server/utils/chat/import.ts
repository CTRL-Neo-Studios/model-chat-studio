import { createError } from 'nuxt/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
// Relative, not `#shared` or `hub:db`, so this module also loads in `bun test`.
import * as tables from '../../db/schema'
import type { Db } from '../core/settings'
import { chatFileSchema, CHAT_FILE_FORMAT, type ChatFile, type ChatFileMessage } from '../../../shared/utils/chatFile'
import { FILE_UPLOAD_TYPES, FILE_URL_PATTERN } from '../../../shared/utils/file'
import type { MessageMetadata } from '../../../shared/utils/chat'

/** The most one attachment may weigh, as for uploads. */
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
/** A user message's text, as for sent messages; an answer's parts may be longer. */
const MAX_USER_TEXT = 100_000
const MAX_PART_JSON = 500_000

// The parts import takes, each checked for what the app reads from it; their other fields stay as they are, so the
// next turn sends what the original chat would (a reasoning part's provider data, for one).
const partSchemas = {
	'text': z.looseObject({ type: z.literal('text'), text: z.string() }),
	'reasoning': z.looseObject({ type: z.literal('reasoning'), text: z.string() }),
	'file': z.looseObject({ type: z.literal('file'), mediaType: z.string().max(100), url: z.string().regex(FILE_URL_PATTERN), filename: z.string().max(255).optional() }),
	'source-url': z.looseObject({ type: z.literal('source-url'), sourceId: z.string().max(200), url: z.url().max(2_000), title: z.string().max(1_000).optional() }),
	'step-start': z.looseObject({ type: z.literal('step-start') }),
	'data-mention': z.looseObject({ type: z.literal('data-mention'), data: z.object({ name: z.string().min(1).max(200) }) }),
	'data-reference': z.looseObject({ type: z.literal('data-reference'), data: z.looseObject({ name: z.string().max(2_000) }) }),
	'tool': z.looseObject({
		type: z.string().regex(/^tool-[a-z0-9_]{1,64}$/),
		toolCallId: z.string().min(1).max(200),
		state: z.enum(['input-available', 'output-available', 'output-error']),
		errorText: z.string().max(10_000).optional(),
	}),
}

/** What an import changed or left out, for the note shown with the new chat. */
type Notes = Record<string, number>
const noted = (notes: Notes, note: string) => notes[note] = (notes[note] ?? 0) + 1

/** The models this member may pick on the active platform: a lane keeps its model only when it is one of them. */
export interface Offered {
	platform: 'openrouter' | 'deepseek' | null
	models: Record<string, true>
}

/**
 * Reads a chat file's text: JSON in the chat file's shape, within its limits. A file of another kind is refused here;
 * readers of other formats (12.3) turn theirs into a chat file first.
 */
export function readChatFile(text: string): ChatFile {
	let json: unknown
	try {
		json = JSON.parse(text)
	}
	catch {
		throw createError({ status: 400, statusText: 'This file is not JSON: import takes a chat file' })
	}
	if ((json as { format?: unknown } | null)?.format !== CHAT_FILE_FORMAT) throw createError({ status: 400, statusText: 'This is not a chat file' })
	const parsed = chatFileSchema.safeParse(json)
	if (!parsed.success) throw createError({ status: 400, statusText: `This chat file is not valid: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}` })
	return parsed.data
}

/** The file's links between messages and lanes, all pointing backwards in the order written; a file that does not hold together is refused. */
function checkShape(file: ChatFile) {
	const seen: Record<string, ChatFileMessage> = {}
	const lanes = Object.fromEntries(file.lanes.map(lane => [lane.id, true]))
	const refuse = (why: string) => {
		throw createError({ status: 400, statusText: `This chat file does not hold together: ${why}` })
	}
	if (Object.keys(lanes).length !== file.lanes.length) refuse('two lanes share an id')
	for (const message of file.messages) {
		if (seen[message.id]) refuse(`message ${message.id} appears twice`)
		const parent = message.parentId === null ? null : seen[message.parentId]
		if (parent === undefined) refuse(`message ${message.id} follows one that is not before it`)
		if (parent && parent.role !== 'user') refuse(`message ${message.id} follows one that is not a user message`)
		if (message.laneId !== null && !lanes[message.laneId]) refuse(`message ${message.id} names a lane the file does not have`)
		if (message.role === 'user' && message.laneId !== null) refuse(`user message ${message.id} names a lane`)
		seen[message.id] = message
	}
	if (file.tipId !== null && seen[file.tipId]?.role !== 'user') refuse('the tip is not one of its user messages')
}

/** A part as stored, checked; `null` leaves it out. Files and drawn images point at their new files. */
function importPart(part: ChatFileMessage['parts'][number], role: ChatFileMessage['role'], files: Record<string, { id: string, mediaType: string } | string>, notes: Notes): ChatFileMessage['parts'][number] | null {
	if (JSON.stringify(part).length > MAX_PART_JSON) {
		noted(notes, 'a part too large to import was left out')
		return null
	}
	const schema = part.type.startsWith('tool-') ? partSchemas.tool : partSchemas[part.type as keyof typeof partSchemas]
	const checked = schema?.safeParse(part)
	if (!checked?.success) {
		noted(notes, `a part of a kind not imported (${part.type.slice(0, 40)}) was left out`)
		return null
	}
	const value = checked.data as Record<string, unknown> & { type: string }
	if (value.type === 'text' && role === 'user' && (value.text as string).length > MAX_USER_TEXT) throw createError({ status: 400, statusText: `A message's text is longer than ${MAX_USER_TEXT.toLocaleString('en-US')} characters` })
	// Libraries do not come with a chat: an "@" pick stays as its name.
	if (value.type === 'data-reference') return { type: 'text', text: `@${(value.data as { name: string }).name}` }
	if (value.type === 'file') {
		const file = files[FILE_URL_PATTERN.exec(value.url as string)![1]!]
		if (typeof file === 'object') return { ...value, url: `/api/v1/files/${file.id}`, mediaType: file.mediaType }
		return { type: 'text', text: `[Attachment not imported: ${(value.filename as string | undefined) ?? value.mediaType}]` }
	}
	if (value.type === 'tool-generate_image' && value.state === 'output-available') {
		const output = value.output as { fileId?: string, prompt?: string } | undefined
		const file = files[output?.fileId ?? '']
		if (typeof file === 'object') return { ...value, output: { ...output, fileId: file.id, url: `/api/v1/files/${file.id}`, mediaType: file.mediaType } }
		return { ...value, state: 'output-error', errorText: 'The image was not imported', output: undefined }
	}
	return value
}

/** Recorded facts about a message, with the lanes in a round's `speakers` renamed to the new lanes. */
function importMetadata(metadata: ChatFileMessage['metadata'], lanes: Record<string, string>): MessageMetadata | null {
	if (!metadata) return null
	if (JSON.stringify(metadata).length > 20_000) return null
	const speakers = Array.isArray(metadata.speakers) ? metadata.speakers.flatMap(id => typeof id === 'string' && lanes[id] ? [lanes[id]] : []) : undefined
	return { ...metadata, ...(speakers && { speakers }) } as MessageMetadata
}

/**
 * Makes a chat file into a new chat of `userId`'s (milestone 12 plan, sections 1 and 2): new ids throughout, in one
 * transaction. A lane whose model is not offered here gets the default model and keeps its name; a lane that had a
 * Character gets its instructions as its own prompt. Attachments pass the upload checks; one that does not, or that
 * the file left out, stays as a line naming it. Costs and models stay on the messages as history; no usage is
 * recorded. `writeFile` stores an attachment and `removeFile` takes it back if the chat cannot be written. Returns
 * the new chat's id and what was changed.
 */
export async function importChat(db: Db, input: {
	userId: string
	file: ChatFile
	folderId: string | null
	offered: Offered
	writeFile: (path: string, bytes: Uint8Array, mediaType: string) => Promise<void>
	removeFile: (path: string) => Promise<void>
}) {
	const { userId, file, offered } = input
	checkShape(file)
	const notes: Notes = {}
	if (input.folderId) {
		const [folder] = await db.select({ id: tables.chatFolder.id }).from(tables.chatFolder).where(and(eq(tables.chatFolder.id, input.folderId), eq(tables.chatFolder.userId, userId)))
		if (!folder) throw createError({ status: 404, statusText: 'Folder not found' })
	}
	const chatId = crypto.randomUUID()

	// Attachments first, outside the transaction: those that pass are stored under new ids.
	const files: Record<string, { id: string, mediaType: string, path: string, size: number, name: string | null } | string> = {}
	for (const attachment of file.attachments) {
		const bytes = attachment.data === undefined ? null : Buffer.from(attachment.data, 'base64')
		const refused = !bytes
			? 'an attachment the file left out'
			: !FILE_UPLOAD_TYPES.includes(attachment.mediaType)
					? `an attachment of a type not accepted (${attachment.mediaType.slice(0, 60)})`
					: bytes.length > MAX_ATTACHMENT_BYTES ? 'an attachment over 8 MB' : null
		if (refused) {
			files[attachment.id] = refused
			noted(notes, `${refused} stays as its name`)
			continue
		}
		const id = crypto.randomUUID()
		const path = `${userId}/${chatId}/${id}`
		await input.writeFile(path, bytes!, attachment.mediaType)
		files[attachment.id] = { id, mediaType: attachment.mediaType, path, size: bytes!.length, name: attachment.name }
	}
	const stored = Object.values(files).filter(entry => typeof entry === 'object')

	try {
		const laneIds = Object.fromEntries(file.lanes.map(lane => [lane.id, crypto.randomUUID()]))
		const messageIds = Object.fromEntries(file.messages.map(message => [message.id, crypto.randomUUID()]))
		const lanes = file.lanes.map((lane) => {
			const kept = lane.modelId !== null && lane.platform === offered.platform && offered.models[lane.modelId]
			if (lane.modelId !== null && !kept) noted(notes, `${lane.modelId} is not offered here: its lane uses the default model`)
			if (lane.character) noted(notes, `${lane.character.name} came as a prompt, not as a Character`)
			const { providers: _, reasoningLevel: __, ...portable } = lane.params
			return {
				id: laneIds[lane.id]!,
				chatId,
				position: lane.position,
				enabled: lane.enabled,
				name: lane.name ?? lane.character?.name ?? (kept ? null : lane.modelId),
				color: lane.color,
				platform: kept ? lane.platform : null,
				modelId: kept ? lane.modelId : null,
				systemPrompt: lane.character?.instructions || lane.systemPrompt,
				// Provider choices and reasoning levels belong to the model; another model starts without them.
				params: kept ? lane.params : portable,
			}
		})
		// The version that shows, one per lane and message: the file's, else the newest.
		const shown: Record<string, string> = {}
		for (const message of file.messages) {
			if (message.role !== 'assistant' || message.laneId === null) continue
			const key = `${message.parentId}:${message.laneId}`
			if (message.active || !shown[key]) shown[key] = message.id
		}
		const firstUse: Record<string, string> = {}
		const messages = file.messages.map((message) => {
			const parts = message.parts.flatMap(part => importPart(part, message.role, files as Record<string, { id: string, mediaType: string } | string>, notes) ?? [])
			for (const part of message.parts) {
				const fileId = part.type === 'file' ? FILE_URL_PATTERN.exec(String(part.url))?.[1] : part.type === 'tool-generate_image' ? (part.output as { fileId?: string } | undefined)?.fileId : undefined
				if (fileId && !firstUse[fileId]) firstUse[fileId] = messageIds[message.id]!
			}
			return {
				id: messageIds[message.id]!,
				chatId,
				parentId: message.parentId ? messageIds[message.parentId]! : null,
				role: message.role,
				parts: parts as typeof tables.message.$inferInsert.parts,
				metadata: importMetadata(message.metadata, laneIds),
				chatModelId: message.laneId ? laneIds[message.laneId]! : null,
				// The chat is the importer's: the messages it holds are theirs.
				userId: message.role === 'user' ? userId : null,
				active: message.role !== 'assistant' || message.laneId === null || shown[`${message.parentId}:${message.laneId}`] === message.id,
				createdAt: new Date(message.createdAt),
			}
		})
		if (file.chat.userCharacter) noted(notes, 'who you were in the chat (a Character) was left out')
		if (file.chat.structureProfile) noted(notes, `its structure profile (${file.chat.structureProfile.name}) was left out`)
		if (file.chat.libraries.length) noted(notes, `its libraries (${file.chat.libraries.join(', ')}) were left out`)

		await db.transaction(async (tx) => {
			await tx.insert(tables.chat).values({ id: chatId, userId, title: file.chat.title, mode: file.chat.mode, settings: file.chat.settings, folderId: input.folderId })
			if (lanes.length) await tx.insert(tables.chatModel).values(lanes)
			// In batches, in the order written: a message's parent is always an earlier one.
			for (let at = 0; at < messages.length; at += 500) await tx.insert(tables.message).values(messages.slice(at, at + 500))
			const votes = file.votes.flatMap(vote => messageIds[vote.messageId] ? [{ chatId, messageId: messageIds[vote.messageId]!, isUpvoted: vote.isUpvoted }] : [])
			if (votes.length) await tx.insert(tables.vote).values(votes)
			const rows = file.attachments.flatMap((attachment) => {
				const entry = files[attachment.id]
				return typeof entry === 'object' ? [{ id: entry.id, ownerId: userId, chatId, messageId: firstUse[attachment.id] ?? null, blobPath: entry.path, fileName: entry.name, mediaType: entry.mediaType, size: entry.size }] : []
			})
			if (rows.length) await tx.insert(tables.file).values(rows)
			if (file.tipId) await tx.update(tables.chat).set({ leafId: messageIds[file.tipId]! }).where(eq(tables.chat.id, chatId))
		})
	}
	catch (error) {
		await Promise.all(stored.map(entry => input.removeFile((entry as { path: string }).path)))
		throw error
	}
	return { chatId, notes: Object.entries(notes).map(([note, count]) => count > 1 ? `${note} (${count} times)` : note) }
}
