import {
	type AnyPgColumn,
	bigint,
	boolean,
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import type {UIMessage} from "ai";
import type {ChatParams, MessageMetadata} from "../../shared/utils/chat";

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

export const chat = pgTable("chat", {
	id: uuid().primaryKey().defaultRandom(),
	userId: uuid().notNull().references(() => user.id, { onDelete: "cascade" }),
	title: text(),
	/** Link access: `public` means anyone with the link can read. */
	visibility: text({ enum: ["private", "public"] }).notNull().default("private"),
	systemPrompt: text(),
	params: jsonb().$type<ChatParams>(),

	...createdUpdatedAtColumns
}, (t) => [
	index().on(t.userId, t.createdAt),
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
	createdAt,
}, (t) => [
	index().on(t.chatId, t.seq),
]);

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
	kind: text({ enum: ["chat", "title", "stt", "parse"] }).notNull(),
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

// Relations

export const userRelations = relations(user, ({ many }) => ({
	chats: many(chat),
	files: many(file),
}))

export const chatRelations = relations(chat, ({ one, many }) => ({
	user: one(user, { fields: [chat.userId], references: [user.id] }),
	messages: many(message),
	shares: many(chatShare),
	votes: many(vote),
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
