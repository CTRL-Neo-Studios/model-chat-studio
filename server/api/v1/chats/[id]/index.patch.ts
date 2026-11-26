import { createError, defineEventHandler, readValidatedBody } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { and, asc, eq, inArray, ne } from 'drizzle-orm'
import { z } from 'zod'
import { chatSettingsSchema } from '#shared/utils/chat'
import type { Db } from '#server/utils/core/settings'
import { requireChat } from '#server/utils/chat/access'
import { fallbackTitle, listChatShares } from '#server/utils/chat/turns'
import { profileAbilities } from '#shared/abilities/profileAbilities'
import { authorize } from '#server/utils/core/authorize'
import { findStructureProfile } from '#server/utils/chat/structureProfiles'
import { assertCharacterUsable } from '#server/utils/chat/characters'

const bodySchema = z.object({
	title: z.string().trim().min(1).max(200),
	visibility: z.enum(['private', 'public']),
	settings: chatSettingsSchema,
	/** Replaces the list of people the chat is shared with, each a `viewer` (reads) or an `editor` (also takes part). */
	sharedWith: z.array(z.object({ userId: z.uuid(), role: z.enum(['viewer', 'editor']) }).strict()).max(100),
	/** One of the owner's folders; `null` takes the chat out of its folder. */
	folderId: z.uuid().nullable(),
	/** "Keep this chat": a temporary chat becomes a normal one, named from its first message. */
	temporary: z.literal(false),
	/** A structure profile of the owner's (or an instance one); `null`: none. */
	structureProfileId: z.uuid().nullable(),
	/** Who the user is in this chat: one of the owner's Characters or an instance one; `null`: nobody. */
	userCharacterId: z.uuid().nullable(),
}).partial().strict()

/** Owner only: title, link access, people, folder, keeping a temporary chat, structure profile, the user's Character, and the settings shared by every lane. */
export default defineEventHandler(async (event) => {
	const chat = await requireChat(event, 'manageChat')
	const { sharedWith, ...fields } = await readValidatedBody(event, bodySchema)
	const temporary = chat.temporary && fields.temporary === undefined
	if (temporary && (fields.visibility === 'public' || sharedWith?.length)) {
		throw createError({ status: 400, statusText: 'A temporary chat cannot be shared. Keep it first.' })
	}
	if (fields.folderId) {
		// One of the owner's folders.
		const [folder] = await db.select({ id: schema.chatFolder.id }).from(schema.chatFolder).where(and(
			eq(schema.chatFolder.id, fields.folderId),
			eq(schema.chatFolder.userId, chat.userId),
		))
		if (!folder) throw createError({ status: 404, statusText: 'Folder not found' })
	}
	if (fields.structureProfileId) await authorize(event, profileAbilities().readProfile, await findStructureProfile(db, fields.structureProfileId))
	await assertCharacterUsable(db, chat.userId, fields.userCharacterId)
	if (chat.temporary && fields.temporary === false && !chat.title && !fields.title) {
		const [first] = await db.select({ parts: schema.message.parts }).from(schema.message)
			.where(and(eq(schema.message.chatId, chat.id), eq(schema.message.role, 'user')))
			.orderBy(asc(schema.message.seq)).limit(1)
		fields.title = fallbackTitle(first?.parts.map(part => part.type === 'text' ? part.text : '').join(' ') ?? '')
	}

	// `updatedAt` keeps the update non-empty when only the people change.
	const update = (tx: Db) => tx.update(schema.chat).set({ ...fields, updatedAt: new Date() }).where(eq(schema.chat.id, chat.id)).returning()
	const view = ({ userId: _, ...row }: typeof schema.chat.$inferSelect, people: Awaited<ReturnType<typeof listChatShares>>) => ({ ...row, sharedWith: people })

	// Without new people, one statement, read alongside the people as they are.
	if (!sharedWith) {
		const [[row], people] = await Promise.all([update(db), listChatShares(db, chat.id)])
		return view(row!, people)
	}
	const [row] = await db.transaction(async (tx) => {
		const rows = await update(tx)
		await tx.delete(schema.chatShare).where(eq(schema.chatShare.chatId, chat.id))
		// Unknown ids and the owner are skipped.
		const people = sharedWith.length
			? await tx.select({ id: schema.user.id }).from(schema.user)
					.where(and(inArray(schema.user.id, sharedWith.map(share => share.userId)), ne(schema.user.id, chat.userId)))
			: []
		const roles = Object.fromEntries(sharedWith.map(share => [share.userId, share.role]))
		if (people.length) await tx.insert(schema.chatShare).values(people.map(person => ({ chatId: chat.id, userId: person.id, role: roles[person.id] })))
		return rows
	})
	return view(row!, await listChatShares(db, chat.id))
})
