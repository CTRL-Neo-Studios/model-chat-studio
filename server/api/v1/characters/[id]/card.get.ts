import { createError, defineEventHandler, getQuery, getRouterParam } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { allows } from 'nuxt-authorization/utils'
import { libraryAbilities } from '#shared/abilities/libraryAbilities'
import { profileAbilities } from '#shared/abilities/profileAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { blob } from '#server/utils/core/blob'
import { findCharacter } from '#server/utils/chat/characters'
import { characterToCard, writeCardPng } from '#server/utils/chat/cards'
import { findLibrary } from '#server/utils/library/libraries'
import { lorebookToCardBook } from '#server/utils/library/lorebookCard'

/**
 * A Character as a V2 character card (plan section 2): `format=json` (the default), or `png`, its PNG avatar with the
 * card inside. Its lorebook is the notes of its libraries with the lorebook switch on that the member may read, the
 * first one's name and options for the book. Own and instance Characters.
 */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	const found = await findCharacter(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, profileAbilities().readProfile, found)
	const character = found!
	const format = getQuery(event).format === 'png' ? 'png' : 'json'

	const libraries = (await Promise.all(character.libraryIds.map(id => findLibrary(db, id)))).filter(library => library?.lorebook?.on)
	const readable = (await Promise.all(libraries.map(async library => await allows(libraryAbilities().readLibrary, user, library!) ? library! : undefined))).filter(library => library !== undefined)
	const notes = readable.length
		? await db.select({ name: schema.libraryEntry.name, tags: schema.libraryEntry.tags, content: schema.libraryEntry.content, lore: schema.libraryEntry.lore })
			.from(schema.libraryEntry)
			.where(and(inArray(schema.libraryEntry.libraryId, readable.map(library => library.id)), eq(schema.libraryEntry.kind, 'note')))
			.orderBy(asc(sql`lower(${schema.libraryEntry.name})`))
		: []
	const book = readable[0] && lorebookToCardBook(readable[0], notes)
	const card = characterToCard(character, book)

	const name = character.name.replace(/[\\/:*?"<>|]/g, '-')
	const disposition = (extension: string) => `attachment; filename="${name.replace(/[^\x20-\x7E]/g, '_')}.${extension}"; filename*=UTF-8''${encodeURIComponent(name)}.${extension}`
	if (format === 'json') {
		return new Response(JSON.stringify(card, null, 2), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': disposition('json') } })
	}

	const [avatar] = character.avatarFileId ? await db.select().from(schema.file).where(eq(schema.file.id, character.avatarFileId)) : []
	const image = avatar && await blob.get(avatar.blobPath)
	if (!avatar || !image) throw createError({ status: 400, statusText: 'This Character has no avatar to carry the card: export it as JSON' })
	const png = writeCardPng(new Uint8Array(await image.arrayBuffer()), card)
	return new Response(png, { headers: { 'Content-Type': 'image/png', 'Content-Length': String(png.length), 'Content-Disposition': disposition('png') } })
})
