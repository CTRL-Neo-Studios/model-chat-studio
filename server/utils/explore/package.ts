import { randomUUID } from 'node:crypto'
import { createError } from 'nuxt/server'
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm'
// Relative, not `#shared` or `hub:db`, so this module also loads in `bun test`.
import * as tables from '../../db/schema'
import type { Db } from '../core/settings'
import { type FolderDefaults, folderDefaultsSchema } from '../../../shared/utils/folderDefaults'
import { type Package, type PackageCopies, type PackageInput, type PackageItems, PACKAGE_LIMITS, packageSchema, packageSize, type PackageSource } from '../../../shared/utils/package'

/** Storage as `#server/utils/core/blob` has it; passed in, so tests bring their own. */
export interface Store {
	get: (path: string) => Promise<Blob | null>
	put: (path: string, data: Blob, options: { contentType: string }) => Promise<unknown>
	del: (path: string) => Promise<unknown>
}

/**
 * Copies stored files, four at a time (spike O: 2.4 MB/s on dev, against 1.0 one at a time). If one fails, the copies
 * already made are removed and the error is thrown.
 */
export async function copyFiles(store: Store, copies: { from: string, to: string, mediaType: string }[]) {
	const made: string[] = []
	try {
		for (let at = 0; at < copies.length; at += 4) {
			await Promise.all(copies.slice(at, at + 4).map(async (copy) => {
				const stored = await store.get(copy.from)
				if (!stored) throw createError({ status: 404, statusText: 'A file of this listing is missing from storage' })
				await store.put(copy.to, stored, { contentType: copy.mediaType })
				made.push(copy.to)
			}))
		}
	}
	catch (error) {
		await removeFiles(store, made)
		throw error
	}
	return made
}

export const removeFiles = (store: Store, paths: string[]) =>
	Promise.all(paths.map(path => store.del(path).catch(error => console.error('[explore] blob delete failed', path, error))))

/** A stored file's extension, kept on its copies. */
export const fileExtension = (path: string) => /\.[a-z0-9]{1,8}$/i.exec(path)?.[0] ?? ''

/**
 * A package of the member's items (milestone 13 plan, section 2): the Characters, libraries and structure profiles
 * asked for, which must be theirs, and a folder's defaults as the setup; or a Content Package's items (those it still
 * has) and setup. What those refer to comes along when it is the member's (a lane's Character, a Character's
 * libraries, the setup's libraries, profile and "who you are"); what is not (a library shared with them, an instance
 * Character) is left out and reported. A lane started from a model profile carries the profile's fields. Returns the
 * package, where each file is stored, and what was left out.
 */
export async function takePackage(db: Db, userId: string, source: PackageSource) {
	const left: string[] = []
	const [folder] = source.folderId
		? await db.select().from(tables.chatFolder).where(and(eq(tables.chatFolder.id, source.folderId), eq(tables.chatFolder.userId, userId)))
		: []
	if (source.folderId && !folder) throw createError({ status: 404, statusText: 'Folder not found' })
	const [contentPackage] = source.packageId
		? await db.select().from(tables.contentPackage).where(and(eq(tables.contentPackage.id, source.packageId), eq(tables.contentPackage.ownerId, userId)))
		: []
	if (source.packageId && !contentPackage) throw createError({ status: 404, statusText: 'Package not found' })
	const asked: Partial<PackageItems> = contentPackage ? await ownedItems(db, userId, contentPackage.items) : source
	const defaults: FolderDefaults | null = folder?.defaults ?? contentPackage?.setup ?? null

	// The setup's lanes with their profiles' fields under their own.
	const lanes = await Promise.all((defaults?.models ?? []).map(async ({ profileId, ...fields }) => {
		const [profile] = profileId
			? await db.select().from(tables.modelProfile).where(and(eq(tables.modelProfile.id, profileId), or(isNull(tables.modelProfile.ownerId), eq(tables.modelProfile.ownerId, userId))))
			: []
		if (profileId && !profile) left.push('A model profile that no longer exists: its lane keeps its own settings')
		const base = profile ? { name: profile.name, color: profile.color, modelId: profile.modelId, systemPrompt: profile.systemPrompt, params: profile.params, characterId: profile.characterId } : {}
		return { ...base, ...fields }
	}))

	// The member's own items, in order: asked for, then referred to. Asked-for ones that are not theirs are not found.
	const characters = await ownRows(db, tables.character, userId, asked.characterIds ?? [], [...lanes.map(lane => lane.characterId), defaults?.userCharacterId], 'Character', left)
	const characterLibraries = characters.length
		? await db.select().from(tables.characterLibrary).where(inArray(tables.characterLibrary.characterId, characters.map(character => character.id))).orderBy(asc(tables.characterLibrary.createdAt))
		: []
	const libraries = await ownRows(db, tables.library, userId, asked.libraryIds ?? [], [...(defaults?.libraryIds ?? []), ...characterLibraries.map(link => link.libraryId)], 'library', left)
	const profiles = await ownRows(db, tables.structureProfile, userId, asked.structureProfileIds ?? [], [defaults?.structureProfileId], 'structure profile', left)

	const files: Package['files'] = []
	const paths: Record<string, string> = {}
	const addFile = async (fileId: string | null) => {
		if (!fileId) return null
		const [row] = await db.select().from(tables.file).where(eq(tables.file.id, fileId))
		if (!row) return null
		const key = `f${files.length + 1}`
		files.push({ key, name: row.fileName ?? 'file', mediaType: row.mediaType, size: row.size })
		paths[key] = row.blobPath
		return key
	}
	const characterKey: Record<string, string> = Object.fromEntries(characters.map((character, index) => [character.id, `c${index + 1}`]))
	const libraryKey: Record<string, string> = Object.fromEntries(libraries.map((library, index) => [library.id, `l${index + 1}`]))
	const profileKey: Record<string, string> = Object.fromEntries(profiles.map((profile, index) => [profile.id, `p${index + 1}`]))
	const entryKey: Record<string, string> = {}

	const packagedCharacters: PackageInput['characters'] = []
	for (const character of characters) {
		packagedCharacters.push({
			key: characterKey[character.id]!,
			name: character.name,
			color: character.color,
			instructions: character.instructions,
			greetings: character.greetings,
			examples: character.examples,
			note: character.note,
			creatorNotes: character.creatorNotes,
			tags: character.tags,
			card: character.card,
			libraryKeys: characterLibraries.flatMap(link => link.characterId === character.id && libraryKey[link.libraryId] ? [libraryKey[link.libraryId]!] : []),
			avatarKey: await addFile(character.avatarFileId),
		})
	}
	const packagedLibraries: PackageInput['libraries'] = []
	for (const library of libraries) {
		const rows = await db.select().from(tables.libraryEntry).where(eq(tables.libraryEntry.libraryId, library.id))
		const entries: PackageInput['libraries'][number]['entries'] = []
		// Depth first, folders then the rest, by name: parents come first, and the order is the same every time.
		const place = async (parentId: string | null) => {
			const children = rows.filter(row => row.parentId === parentId)
				.toSorted((a, b) => Number(a.kind !== 'folder') - Number(b.kind !== 'folder') || a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.name.localeCompare(b.name))
			for (const row of children) {
				const key = entryKey[row.id] = `e${Object.keys(entryKey).length + 1}`
				entries.push({ key, parentKey: row.parentId ? entryKey[row.parentId]! : null, kind: row.kind, name: row.name, tags: row.tags, content: row.kind === 'note' ? row.content ?? '' : null, lore: row.lore, fileKey: row.kind === 'file' ? await addFile(row.fileId) : null })
				if (row.kind === 'folder') await place(row.id)
			}
		}
		await place(null)
		packagedLibraries.push({ key: libraryKey[library.id]!, name: library.name, description: library.description, lorebook: library.lorebook, entries })
	}

	let setup: PackageInput['setup'] = null
	if (defaults) {
		const settings = defaults.settings
		const folders = settings?.autoFetch?.folders?.flatMap(id => entryKey[id] ? [entryKey[id]!] : [])
		if (folders && folders.length < settings!.autoFetch!.folders!.length) left.push('Auto-fetch folders outside the listing\'s libraries')
		setup = {
			...(defaults.models && { models: lanes.map(({ characterId, ...fields }) => ({ ...fields, ...(characterId !== undefined && { characterKey: characterId ? characterKey[characterId] ?? null : null }) })) }),
			...(defaults.mode && { mode: defaults.mode }),
			libraryKeys: defaults.libraryIds.flatMap(id => libraryKey[id] ? [libraryKey[id]!] : []),
			structureProfileKey: defaults.structureProfileId ? profileKey[defaults.structureProfileId] ?? null : null,
			...(defaults.userCharacterId !== undefined && { userCharacterKey: defaults.userCharacterId ? characterKey[defaults.userCharacterId] ?? null : null }),
			...(settings && { settings: { ...settings, ...(settings.autoFetch && { autoFetch: { ...settings.autoFetch, ...(folders && { folders }) } }) } }),
		}
	}

	const content = { characters: packagedCharacters, libraries: packagedLibraries, structureProfiles: profiles.map(profile => ({ key: profileKey[profile.id]!, name: profile.name, blocks: profile.blocks })), files, setup }
	if (packageSize(content) > PACKAGE_LIMITS.bytes) throw createError({ status: 413, statusText: `A listing can be at most ${PACKAGE_LIMITS.bytes / 1024 / 1024} MB with its files` })
	const parsed = packageSchema.safeParse(content)
	if (!parsed.success) throw createError({ status: 400, statusText: parsed.error.issues[0]!.message })
	return { content: parsed.data, paths, left }
}

/**
 * The member's own rows of a table with an `ownerId`, asked for then referred to, each once, in that order. One asked
 * for that is not theirs is not found; one referred to is left out and reported.
 */
async function ownRows<T extends typeof tables.character | typeof tables.library | typeof tables.structureProfile>(db: Db, table: T, userId: string, asked: string[], referred: (string | null | undefined)[], kind: string, left: string[]): Promise<T['$inferSelect'][]> {
	const ids = [...new Set([...asked, ...referred.filter((id): id is string => !!id)])]
	if (!ids.length) return []
	const rows = await db.select().from(table as typeof tables.library).where(inArray(table.id, ids)) as T['$inferSelect'][]
	const byId = Object.fromEntries(rows.map(row => [row.id, row]))
	return ids.flatMap((id) => {
		const row = byId[id]
		if (row?.ownerId === userId) return [row]
		if (asked.includes(id)) throw createError({ status: 404, statusText: `${kind[0]!.toUpperCase()}${kind.slice(1)} not found` })
		if (row) left.push(`The ${kind} “${row.name}” is not yours, so it is left out`)
		return []
	})
}

/**
 * The ids of `items` the member still owns, in their order: what a Content Package holds once an item was deleted
 * (or given away) elsewhere.
 */
export async function ownedItems(db: Db, userId: string, items: PackageItems): Promise<PackageItems> {
	const own = async (table: typeof tables.character | typeof tables.library | typeof tables.structureProfile, ids: string[]) => {
		if (!ids.length) return []
		const rows = await db.select({ id: table.id }).from(table as typeof tables.library).where(and(inArray(table.id, ids), eq(table.ownerId, userId)))
		return ids.filter(id => rows.some(row => row.id === id))
	}
	const [characterIds, libraryIds, structureProfileIds] = await Promise.all([own(tables.character, items.characterIds), own(tables.library, items.libraryIds), own(tables.structureProfile, items.structureProfileIds)])
	return { characterIds, libraryIds, structureProfileIds }
}

/**
 * Makes a member's copies of a package (milestone 13 plan, section 2): its Characters with their avatars and
 * libraries, its libraries with their files, its structure profiles, and, when it has a setup, a folder named
 * `folderName` whose defaults are that setup. New ids throughout. Files are copied from `paths` (where each key's
 * file is stored) first; then every row is written in one transaction, one insert per table; if that fails, the
 * copies are removed. Returns the ids made.
 */
export async function givePackage(db: Db, store: Store, input: { userId: string, content: PackageInput, paths: Record<string, string>, folderName: string }): Promise<PackageCopies> {
	const content = packageSchema.parse(input.content)
	const { userId } = input
	const ids: Record<string, string> = {}
	const id = (key: string) => ids[key] ??= randomUUID()
	const idOf = (key: string | null | undefined) => key ? id(key) : null

	// Where each file goes: an avatar under its Character, a library file under its library, as uploads are stored.
	const destination: Record<string, string> = {}
	for (const character of content.characters) {
		if (character.avatarKey) destination[character.avatarKey] = `avatars/${id(character.key)}/${id(character.avatarKey)}`
	}
	for (const library of content.libraries) {
		for (const entry of library.entries) {
			if (entry.fileKey) destination[entry.fileKey] = `libraries/${id(library.key)}/${id(entry.fileKey)}`
		}
	}
	const files = content.files.map(file => ({ ...file, from: input.paths[file.key]!, blobPath: `${destination[file.key]!}${fileExtension(input.paths[file.key] ?? '')}` }))
	if (files.some(file => !file.from)) throw createError({ status: 404, statusText: 'A file of this listing is missing from storage' })
	const copied = await copyFiles(store, files.map(file => ({ from: file.from, to: file.blobPath, mediaType: file.mediaType })))

	const setup = content.setup
	const defaults: FolderDefaults | null = setup && folderDefaultsSchema.parse({
		libraryIds: setup.libraryKeys.map(id),
		structureProfileId: idOf(setup.structureProfileKey),
		...(setup.models && { models: setup.models.map(({ characterKey, ...fields }) => ({ ...fields, ...(characterKey !== undefined && { characterId: idOf(characterKey) }) })) }),
		...(setup.mode && { mode: setup.mode }),
		...(setup.userCharacterKey !== undefined && { userCharacterId: idOf(setup.userCharacterKey) }),
		...(setup.settings && { settings: { ...setup.settings, ...(setup.settings.autoFetch && { autoFetch: { ...setup.settings.autoFetch, ...(setup.settings.autoFetch.folders && { folders: setup.settings.autoFetch.folders.map(id) }) } }) } }),
	})
	const folderId = setup ? randomUUID() : null

	try {
		await db.transaction(async (tx) => {
			if (files.length) await tx.insert(tables.file).values(files.map(file => ({ id: id(file.key), ownerId: userId, chatId: null, blobPath: file.blobPath, fileName: file.name, mediaType: file.mediaType, size: file.size })))
			if (content.characters.length) {
				await tx.insert(tables.character).values(content.characters.map(({ key, libraryKeys: _libraries, avatarKey, ...fields }) => ({ ...fields, id: id(key), ownerId: userId, avatarFileId: idOf(avatarKey) })))
			}
			if (content.libraries.length) {
				await tx.insert(tables.library).values(content.libraries.map(library => ({ id: id(library.key), ownerId: userId, name: library.name, description: library.description, lorebook: library.lorebook })))
				// One insert per library (spike O: a statement per row would take minutes with the database where it is).
				await Promise.all(content.libraries.filter(library => library.entries.length).map(library => tx.insert(tables.libraryEntry).values(library.entries.map(entry => ({
					id: id(entry.key), libraryId: id(library.key), parentId: idOf(entry.parentKey), kind: entry.kind, name: entry.name, tags: entry.tags, content: entry.content, lore: entry.lore, fileId: idOf(entry.fileKey), createdBy: userId,
				})))))
			}
			// Attach order is `createdAt`: one statement would give every link the same time.
			const now = Date.now()
			const links = content.characters.flatMap(character => character.libraryKeys.map(key => ({ characterId: id(character.key), libraryId: id(key) })))
			if (links.length) await tx.insert(tables.characterLibrary).values(links.map((link, index) => ({ ...link, createdAt: new Date(now + index) })))
			if (content.structureProfiles.length) await tx.insert(tables.structureProfile).values(content.structureProfiles.map(profile => ({ id: id(profile.key), ownerId: userId, name: profile.name, blocks: profile.blocks })))
			if (folderId) await tx.insert(tables.chatFolder).values({ id: folderId, userId, parentId: null, name: input.folderName, defaults })
		})
	}
	catch (error) {
		await removeFiles(store, copied)
		throw error
	}
	return {
		characterIds: content.characters.map(character => id(character.key)),
		libraryIds: content.libraries.map(library => id(library.key)),
		structureProfileIds: content.structureProfiles.map(profile => id(profile.key)),
		folderId,
	}
}
