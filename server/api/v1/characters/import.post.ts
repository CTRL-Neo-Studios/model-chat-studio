import { createError, defineEventHandler } from 'nuxt/server'
import { db, schema } from 'hub:db'
import { libraryAbilities } from '#shared/abilities/libraryAbilities'
import { profileAbilities } from '#shared/abilities/profileAbilities'
import { authorize } from '#server/utils/core/authorize'
import { useServerAuth } from '#server/utils/core/useServerAuth'
import { findCharacter, setCharacterLibraries } from '#server/utils/chat/characters'
import { cardToCharacter, readCardFile } from '#server/utils/chat/cards'
import { avatarType, MAX_AVATAR_BYTES, storeAvatar } from '#server/utils/chat/avatars'
import { cardBookToLorebook } from '#server/utils/library/lorebookCard'

const MAX_CARD_BYTES = 10 * 1024 * 1024

/**
 * Imports a character card (form field `file`: a PNG with the card in it, or its JSON; V1, V2 or V3) as a Character
 * of the member's, the PNG as its avatar, and its lorebook as a library of the member's with its lorebook switch on,
 * attached to the Character. Nothing the card names is fetched. Returns the Character and what was converted or is
 * not used here.
 */
export default defineEventHandler(async (event) => {
	const user = await useServerAuth().requireUser(event)
	await authorize(event, profileAbilities().useProfiles)
	const upload = (await event.req.formData()).get('file')
	if (!(upload instanceof File)) throw createError({ status: 400, statusText: 'Send the card in the `file` field' })
	if (upload.size > MAX_CARD_BYTES) throw createError({ status: 413, statusText: 'A card file can be at most 10 MB' })

	const { card: raw, image } = readCardFile(new Uint8Array(await upload.arrayBuffer()))
	const { fields, card, book, report } = cardToCharacter(raw)
	if (book) await authorize(event, libraryAbilities().useLibraries)
	const [created] = await db.insert(schema.character).values({ ...fields, color: null, card, ownerId: user.id }).returning()

	if (book) {
		const converted = cardBookToLorebook(book)
		const [library] = await db.insert(schema.library).values({
			ownerId: user.id,
			name: converted.name ?? `${fields.name} lorebook`.slice(0, 100),
			description: converted.description ?? null,
			lorebook: converted.lorebook,
		}).returning()
		if (converted.notes.length) {
			await db.insert(schema.libraryEntry).values(converted.notes.map(note => ({ ...note, libraryId: library!.id, kind: 'note' as const, parentId: null, createdBy: user.id })))
		}
		await setCharacterLibraries(db, created!.id, [library!.id])
		report.unshift(`Its lorebook became the library “${library!.name}” (${converted.notes.length} ${converted.notes.length === 1 ? 'note' : 'notes'}), with its lorebook switch on, read by this Character.`, ...converted.report)
	}

	if (image) {
		const type = avatarType(image.subarray(0, 12))
		if (image.length > MAX_AVATAR_BYTES) report.push('Its picture is over 2 MB, so it has no avatar: set a smaller one.')
		else if (type) await storeAvatar(db, { characterId: created!.id, previousFileId: null, userId: user.id, data: new Blob([image]), fileName: upload.name, type })
	}
	return { character: (await findCharacter(db, created!.id))!, report }
})
