import { z } from 'zod'
import { chatSettingsSchema, LANE_COLORS, modelParamsSchema } from './chat'

/**
 * The chat file (milestone 12): one chat as JSON, everything needed to make it again on another account or instance.
 * Export writes it, import reads it, and the readers of other formats turn theirs into it. Ids are the file's own:
 * import gives everything new ids.
 */
export const CHAT_FILE_FORMAT = 'model-chat-studio.chat'
export const CHAT_FILE_VERSION = 1
/** What one chat file may hold: its size, and how many messages (milestone 12 plan, "Trust"). */
export const CHAT_FILE_LIMITS = { bytes: 25 * 1024 * 1024, messages: 5_000 }

const id = z.string().min(1).max(64)
const name = z.string().max(200)

/** A Character as text: who the lane (or the user) was. A chat file carries no Characters as Characters. */
const characterTextSchema = z.object({
	name,
	instructions: z.string().max(100_000),
	examples: z.string().max(100_000),
	note: z.string().max(20_000),
}).strict()

const laneSchema = z.object({
	id,
	position: z.number().int().min(0),
	enabled: z.boolean(),
	name: name.nullable(),
	color: z.enum(LANE_COLORS).nullable(),
	platform: z.enum(['openrouter', 'deepseek']).nullable(),
	modelId: z.string().max(200).nullable(),
	systemPrompt: z.string().max(100_000).nullable(),
	params: modelParamsSchema,
	character: characterTextSchema.nullable(),
}).strict()

/**
 * A message part as the chat stores it (text, reasoning, files, sources, tool calls, "@" references). Here only its
 * type is described; import checks the parts it takes, field by field (12.2).
 */
const partSchema = z.looseObject({ type: z.string().min(1).max(100) })

const messageSchema = z.object({
	id,
	role: z.enum(['user', 'assistant', 'system']),
	/** An answer's user message; a user message's or summary's, the user message before it on its branch. */
	parentId: id.nullable(),
	/** The lane that wrote an answer or summary; `null` on user messages and on answers of no lane (`/image`). */
	laneId: id.nullable(),
	/** On answers, the version that shows; the lane's other answers to the same message are its earlier versions. */
	active: z.boolean(),
	/** Who sent a user message, by name. */
	author: name.nullable(),
	parts: z.array(partSchema).max(1_000),
	/** Model, cost, tokens, who answered, speakers, kind: as recorded when it was written. */
	metadata: z.looseObject({}).nullable(),
	createdAt: z.iso.datetime(),
}).strict()

const attachmentSchema = z.object({
	/** The id its message parts name in their `/api/v1/files/<id>` URLs. */
	id,
	name: name.nullable(),
	mediaType: z.string().max(100),
	size: z.number().int().min(0),
	/** The file itself, base64; absent when the export left attachments out. */
	data: z.string().optional(),
}).strict()

export const chatFileSchema = z.object({
	format: z.literal(CHAT_FILE_FORMAT),
	version: z.literal(CHAT_FILE_VERSION),
	exportedAt: z.iso.datetime(),
	chat: z.object({
		title: name.nullable(),
		mode: z.enum(['separate', 'group']),
		settings: chatSettingsSchema,
		/** Who the user was in the chat, as text. */
		userCharacter: characterTextSchema.nullable(),
		/** The chat's structure profile, as information: import does not make it again. */
		structureProfile: z.object({ name, blocks: z.array(z.looseObject({})).max(200) }).strict().nullable(),
		/** The chat's libraries by name, as information: a chat file carries no libraries. */
		libraries: z.array(name).max(100),
	}).strict(),
	lanes: z.array(laneSchema).max(50),
	/** Every message of every branch and version, in the order written. */
	messages: z.array(messageSchema).max(CHAT_FILE_LIMITS.messages),
	/** The branch that shows: its last user message. */
	tipId: id.nullable(),
	votes: z.array(z.object({ messageId: id, isUpvoted: z.boolean() }).strict()).max(CHAT_FILE_LIMITS.messages),
	attachments: z.array(attachmentSchema).max(1_000),
}).strict()

export type ChatFile = z.infer<typeof chatFileSchema>
export type ChatFileMessage = ChatFile['messages'][number]
