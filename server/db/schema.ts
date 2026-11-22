import {
	type AnyPgColumn,
	bigint,
	boolean,
	customType,
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import {relations, sql} from "drizzle-orm";
import type {UIMessage} from "ai";
import {type ChatSettings, type ContextBlock, LANE_COLORS, type MessageMetadata, type ModelParams} from "../../shared/utils/chat";
import type {UserPreferences} from "../../shared/utils/preferences";
import type {ProfileBlock} from "../../shared/utils/contextProfile";

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' })

const createdAt = timestamp({ withTimezone: true }).defaultNow().notNull()

const createdUpdatedAtColumns = {
	createdAt,
	updatedAt: timestamp({ withTimezone: true })
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
}

/** USD amounts. Returned as numbers, not strings. */
const usd = () => numeric({ precision: 16, scale: 8, mode: 'number' })

export const inferencePlatforms = ["openrouter", "deepseek"] as const

// Tables

export const user = pgTable("user", {
	id: uuid().primaryKey().defaultRandom(),
	githubId: bigint({ mode: 'number' }).notNull().unique(),
	username: text().notNull(),
	name: text(),
	email: text(),
	avatarUrl: text(),
	role: text({ enum: ["user", "moderator", "admin"] })
		.default("user")
		.notNull(),
	banned: boolean().notNull().default(false),
	banReason: text(),
	banExpires: timestamp({ withTimezone: true }),
	/** `null` falls back to the instance default. */
	monthlyBudgetUsd: usd(),
	/** Read through `userPreferencesSchema`, which fills in defaults. */
	preferences: jsonb().$type<Partial<UserPreferences>>().notNull().default({}),

	...createdUpdatedAtColumns
});

export const invite = pgTable("invite", {
	id: uuid().primaryKey().defaultRandom(),
	codeHash: text().notNull().unique(),
	createdBy: uuid().references(() => user.id, { onDelete: "set null" }),
	maxUses: integer().notNull().default(1),
	useCount: integer().notNull().default(0),
	expiresAt: timestamp({ withTimezone: true }),
	revokedAt: timestamp({ withTimezone: true }),
	createdAt,
});

export const setting = pgTable("setting", {
	key: text().primaryKey(),
	value: jsonb().notNull(),
	updatedAt: timestamp({ withTimezone: true })
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
});

export const modelSetting = pgTable("modelSetting", {
	platform: text({ enum: inferencePlatforms }).notNull(),
	modelId: text().notNull(),
	/** Allowlist membership. Off by default, so a row that only overrides prices allowlists nothing. */
	enabled: boolean().notNull().default(false),
	/** USD per 1M tokens; `null` means no override. */
	priceInput: usd(),
	priceCachedInput: usd(),
	priceOutput: usd(),
}, (t) => [
	primaryKey({ columns: [t.platform, t.modelId] }),
]);

export const userApiKey = pgTable("userApiKey", {
	userId: uuid().notNull().references(() => user.id, { onDelete: "cascade" }),
	platform: text({ enum: inferencePlatforms }).notNull(),
	/** First byte of the decoded value is the encryption key version. */
	ciphertext: text().notNull(),

	...createdUpdatedAtColumns
}, (t) => [
	primaryKey({ columns: [t.userId, t.platform] }),
]);

/** A member's folder of chats. Folders nest; their order is by name, so there is no position. */
export const chatFolder = pgTable("chatFolder", {
	id: uuid().primaryKey().defaultRandom(),
	userId: uuid().notNull().references(() => user.id, { onDelete: "cascade" }),
	/** `null` is the top level. Deleting a folder moves its content up first; `set null` is a backstop. */
	parentId: uuid().references((): AnyPgColumn => chatFolder.id, { onDelete: "set null" }),
	name: text().notNull(),
	/** A project's own folder tree; `null` is the member's personal folders. */
	projectId: uuid().references((): AnyPgColumn => project.id, { onDelete: "cascade" }),

	...createdUpdatedAtColumns
}, (t) => [
	index().on(t.userId),
]);

export const chat = pgTable("chat", {
	id: uuid().primaryKey().defaultRandom(),
	userId: uuid().notNull().references(() => user.id, { onDelete: "cascade" }),
	title: text(),
	/** Link access: `public` means anyone with the link can read. */
	visibility: text({ enum: ["private", "public"] }).notNull().default("private"),
	/** Settings shared by every lane; each lane's model settings live in `chatModel`. */
	settings: jsonb().$type<ChatSettings>().notNull().default({}),
	/** `null` is no folder. */
	folderId: uuid().references(() => chatFolder.id, { onDelete: "set null" }),
	/** Hidden from the chat list and deleted when its page is left; swept after 24 h. "Keep this chat" clears it. */
	temporary: boolean().notNull().default(false),
	/** The project the chat belongs to; `null` is a personal chat. Deleting the project keeps the chat as a personal one. */
	projectId: uuid().references((): AnyPgColumn => project.id, { onDelete: "set null" }),
	/** A project chat's own context profile; `null` uses the project's. */
	contextProfileId: uuid().references((): AnyPgColumn => contextProfile.id, { onDelete: "set null" }),
	/** A project chat that everyone in the project may read. It stays its author's to write in. */
	projectVisible: boolean().notNull().default(false),

	...createdUpdatedAtColumns
}, (t) => [
	index().on(t.userId, t.createdAt),
]);

/** A model with its settings, used to start lanes. `ownerId` `null` is an instance profile, published by an admin. */
export const modelProfile = pgTable("modelProfile", {
	id: uuid().primaryKey().defaultRandom(),
	ownerId: uuid().references(() => user.id, { onDelete: "cascade" }),
	name: text().notNull(),
	color: text({ enum: LANE_COLORS }),
	/** The platform `modelId` belongs to: the active one when the model was chosen. */
	platform: text({ enum: inferencePlatforms }).notNull(),
	modelId: text().notNull(),
	/** `null` uses the default instructions. */
	systemPrompt: text(),
	params: jsonb().$type<ModelParams>().notNull().default({}),

	...createdUpdatedAtColumns
}, (t) => [
	index().on(t.ownerId),
]);

/** A lane: one model answering in a chat, with its own settings and its own thread of answers. */
export const chatModel = pgTable("chatModel", {
	id: uuid().primaryKey().defaultRandom(),
	chatId: uuid().notNull().references(() => chat.id, { onDelete: "cascade" }),
	/** The profile the lane was started from; changing the lane does not change the profile. */
	profileId: uuid().references(() => modelProfile.id, { onDelete: "set null" }),
	position: integer().notNull(),
	enabled: boolean().notNull().default(true),
	/** `null` shows the model's name. */
	name: text(),
	color: text({ enum: LANE_COLORS }),
	/** The platform `modelId` belongs to; set together with it. */
	platform: text({ enum: inferencePlatforms }),
	/** `null` is the active platform's default model. */
	modelId: text(),
	systemPrompt: text(),
	params: jsonb().$type<ModelParams>().notNull().default({}),
	createdAt,
}, (t) => [
	index().on(t.chatId, t.position),
]);

export const chatShare = pgTable("chatShare", {
	chatId: uuid().notNull().references(() => chat.id, { onDelete: "cascade" }),
	userId: uuid().notNull().references(() => user.id, { onDelete: "cascade" }),
	createdAt,
}, (t) => [
	primaryKey({ columns: [t.chatId, t.userId] }),
	index().on(t.userId),
]);

export const message = pgTable("message", {
	id: text().primaryKey(),
	/** Insertion order. `createdAt` is not precise enough to order messages. */
	seq: integer().generatedAlwaysAsIdentity(),
	chatId: uuid().notNull().references(() => chat.id, { onDelete: "cascade" }),
	parentId: text().references((): AnyPgColumn => message.id, { onDelete: "set null" }),
	role: text({ enum: ["user", "assistant", "system"] }).notNull(),
	parts: jsonb().$type<UIMessage['parts']>().notNull(),
	metadata: jsonb().$type<MessageMetadata>(),
	/** The lane that wrote an answer; `null` on user messages and on answers of a deleted lane. */
	chatModelId: uuid().references(() => chatModel.id, { onDelete: "set null" }),
	createdAt,
}, (t) => [
	index().on(t.chatId, t.seq),
]);

/** What one answer was given: its context blocks in the order sent. Messages and files are referenced, not copied. */
export const turnTrace = pgTable("turnTrace", {
	messageId: text().primaryKey().references(() => message.id, { onDelete: "cascade" }),
	blocks: jsonb().$type<ContextBlock[]>().notNull(),
	createdAt,
});

export const vote = pgTable("vote", {
	chatId: uuid().notNull().references(() => chat.id, { onDelete: "cascade" }),
	messageId: text().notNull().references(() => message.id, { onDelete: "cascade" }),
	isUpvoted: boolean().notNull(),
}, (t) => [
	primaryKey({ columns: [t.chatId, t.messageId] }),
]);

export const file = pgTable("file", {
	id: uuid().primaryKey().defaultRandom(),
	ownerId: uuid().references(() => user.id, { onDelete: "set null", onUpdate: "cascade" }),
	/** No foreign key: the home page uploads before the chat row exists. */
	chatId: uuid(),
	messageId: text().references(() => message.id, { onDelete: "set null" }),
	blobPath: text().notNull(),
	fileName: text(),
	mediaType: text().notNull(),
	size: integer().notNull(),

	...createdUpdatedAtColumns
}, (t) => [
	index().on(t.chatId),
]);

/** A project: a file space with its own chats, shared with people in `projectMember`. */
export const project = pgTable("project", {
	id: uuid().primaryKey().defaultRandom(),
	ownerId: uuid().notNull().references(() => user.id, { onDelete: "cascade" }),
	name: text().notNull(),
	description: text(),
	/** The context profile the project's chats use unless a chat picks its own. */
	contextProfileId: uuid().references((): AnyPgColumn => contextProfile.id, { onDelete: "set null" }),

	...createdUpdatedAtColumns
}, (t) => [
	index().on(t.ownerId),
]);

export const projectRoles = ["viewer", "member", "editor"] as const

/** Someone a project is shared with, and what they may do: read (`viewer`), also start chats (`member`), also edit the file space (`editor`). */
export const projectMember = pgTable("projectMember", {
	projectId: uuid().notNull().references(() => project.id, { onDelete: "cascade" }),
	userId: uuid().notNull().references(() => user.id, { onDelete: "cascade" }),
	role: text({ enum: projectRoles }).notNull(),
	createdAt,
}, (t) => [
	primaryKey({ columns: [t.projectId, t.userId] }),
	index().on(t.userId),
]);

/** Blocks of conversation data sent around a project chat's thread. `ownerId` `null` is an instance profile, published by an admin. */
export const contextProfile = pgTable("contextProfile", {
	id: uuid().primaryKey().defaultRandom(),
	ownerId: uuid().references(() => user.id, { onDelete: "cascade" }),
	name: text().notNull(),
	blocks: jsonb().$type<ProfileBlock[]>().notNull(),

	...createdUpdatedAtColumns
}, (t) => [
	index().on(t.ownerId),
]);

/** One node of a project's file space: a folder, an uploaded file or a Markdown note. */
export const projectEntry = pgTable("projectEntry", {
	id: uuid().primaryKey().defaultRandom(),
	projectId: uuid().notNull().references(() => project.id, { onDelete: "cascade" }),
	/** `null` is the top level. Deleting a folder deletes everything in it. */
	parentId: uuid().references((): AnyPgColumn => projectEntry.id, { onDelete: "cascade" }),
	kind: text({ enum: ["folder", "file", "note"] }).notNull(),
	name: text().notNull(),
	tags: text().array().notNull().default(sql`'{}'::text[]`),
	/** The upload, for a file. Its blob is deleted with the entry. */
	fileId: uuid().references(() => file.id, { onDelete: "cascade" }),
	/** Markdown, for a note. */
	content: text(),
	/**
	 * The name and text of a note or text file, with words split by the app (`Intl.Segmenter`, so Chinese words are
	 * separate) for full-text search. `null` until filled: search fills what is missing, and a change of name or text
	 * clears it.
	 */
	searchText: text(),
	searchVector: tsvector().generatedAlwaysAs(sql`to_tsvector('english', coalesce("searchText", ''))`),
	createdBy: uuid().references(() => user.id, { onDelete: "set null" }),

	...createdUpdatedAtColumns
}, (t) => [
	// Names are unique within a folder, the top level included.
	unique().on(t.projectId, t.parentId, t.name).nullsNotDistinct(),
	index().on(t.fileId),
	index().using('gin', t.searchVector),
]);

/** A file uploaded to a platform (DeepSeek PDFs), cached per account key. */
export const providerFile = pgTable("providerFile", {
	fileId: uuid().notNull().references(() => file.id, { onDelete: "cascade" }),
	platform: text({ enum: inferencePlatforms }).notNull(),
	/** Hash of the API key it was uploaded with: remote ids belong to one account. */
	keyHash: text().notNull(),
	remoteId: text().notNull(),
	expiresAt: timestamp({ withTimezone: true }),
	createdAt,
}, (t) => [
	primaryKey({ columns: [t.fileId, t.platform, t.keyHash] }),
]);

/** Append-only spend ledger. Messages can be deleted by edits; spend cannot. */
export const usageEvent = pgTable("usageEvent", {
	id: uuid().primaryKey().defaultRandom(),
	userId: uuid().notNull().references(() => user.id, { onDelete: "cascade" }),
	chatId: uuid().references(() => chat.id, { onDelete: "set null" }),
	kind: text({ enum: ["chat", "title", "stt", "parse", "compact"] }).notNull(),
	platform: text({ enum: inferencePlatforms }).notNull(),
	model: text(),
	provider: text(),
	inputTokens: integer(),
	cachedInputTokens: integer(),
	outputTokens: integer(),
	reasoningTokens: integer(),
	/** `null` when the cost is unknown. */
	costUsd: usd(),
	/** Paid with the user's own key; does not count against the budget. */
	byok: boolean().notNull().default(false),
	createdAt,
}, (t) => [
	index().on(t.userId, t.createdAt),
]);

export const pinKinds = ["chat", "chatFolder", "modelProfile", "project", "contextProfile"] as const

/**
 * What a member pinned to the top of a list. Per member, since instance profiles (and later shared projects)
 * are pinned by each person on their own. No foreign key to the pinned row: a pin left by a deletion is ignored.
 */
export const pin = pgTable("pin", {
	userId: uuid().notNull().references(() => user.id, { onDelete: "cascade" }),
	kind: text({ enum: pinKinds }).notNull(),
	targetId: uuid().notNull(),
	createdAt,
}, (t) => [
	primaryKey({ columns: [t.userId, t.kind, t.targetId] }),
]);

// Relations

export const userRelations = relations(user, ({ many }) => ({
	chats: many(chat),
	files: many(file),
}))

export const chatRelations = relations(chat, ({ one, many }) => ({
	user: one(user, { fields: [chat.userId], references: [user.id] }),
	folder: one(chatFolder, { fields: [chat.folderId], references: [chatFolder.id] }),
	messages: many(message),
	models: many(chatModel),
	shares: many(chatShare),
	votes: many(vote),
}))

export const chatModelRelations = relations(chatModel, ({ one }) => ({
	chat: one(chat, { fields: [chatModel.chatId], references: [chat.id] }),
	profile: one(modelProfile, { fields: [chatModel.profileId], references: [modelProfile.id] }),
}))

export const modelProfileRelations = relations(modelProfile, ({ one }) => ({
	owner: one(user, { fields: [modelProfile.ownerId], references: [user.id] }),
}))

export const chatShareRelations = relations(chatShare, ({ one }) => ({
	chat: one(chat, { fields: [chatShare.chatId], references: [chat.id] }),
	user: one(user, { fields: [chatShare.userId], references: [user.id] }),
}))

export const messageRelations = relations(message, ({ one }) => ({
	chat: one(chat, { fields: [message.chatId], references: [chat.id] }),
}))

export const voteRelations = relations(vote, ({ one }) => ({
	chat: one(chat, { fields: [vote.chatId], references: [chat.id] }),
	message: one(message, { fields: [vote.messageId], references: [message.id] }),
}))

export const fileRelations = relations(file, ({ one, many }) => ({
	owner: one(user, { fields: [file.ownerId], references: [user.id] }),
	providerFiles: many(providerFile),
}))

export const providerFileRelations = relations(providerFile, ({ one }) => ({
	file: one(file, { fields: [providerFile.fileId], references: [file.id] }),
}))
