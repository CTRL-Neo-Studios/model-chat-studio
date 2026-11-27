import { z } from 'zod'
import { characterFieldsSchema } from './character'
import { chatSettingsSchema, laneFieldsSchema } from './chat'
import { FILE_UPLOAD_TYPES } from './file'
import { entryNameSchema, libraryDescriptionSchema, libraryNameSchema, noteContentSchema, tagsSchema } from './libraryFields'
import { loreSchema, lorebookSchema } from './lorebook'
import { structureProfileFieldsSchema } from './structureProfile'

/** What one listing may hold (milestone 13 plan, section 1). */
export const PACKAGE_LIMITS = { bytes: 25 * 1024 * 1024, characters: 12, libraries: 5, entries: 500, structureProfiles: 10 }

/** The most one file may weigh, as for uploads. */
const MAX_FILE_BYTES = 8 * 1024 * 1024

/** Items name each other by keys inside the package (`c1`, `l1`, `e1`, `p1`, `f1`), never by database ids. */
const key = z.string().regex(/^[a-z]\d{1,4}$/)

/** A file of the package: an avatar or a library file. Its bytes are stored beside the package, under its key. */
const fileSchema = z.object({
	key,
	name: z.string().trim().min(1).max(255),
	mediaType: z.string().refine(type => FILE_UPLOAD_TYPES.includes(type), 'Images, PDFs and text files only'),
	size: z.number().int().min(0).max(MAX_FILE_BYTES, 'A file can be at most 8 MB'),
})

const characterSchema = characterFieldsSchema.omit({ libraryIds: true }).extend({
	key,
	libraryKeys: z.array(key).max(5),
	avatarKey: key.nullable(),
	/** An imported card's fields that have no place here, as the Character keeps them. */
	card: z.record(z.string(), z.unknown()).nullable(),
})

/** A folder, note or file of a library; parents come before their children. */
const entrySchema = z.object({
	key,
	parentKey: key.nullable(),
	kind: z.enum(['folder', 'file', 'note']),
	name: entryNameSchema,
	tags: tagsSchema,
	content: noteContentSchema.nullable(),
	lore: loreSchema.nullable(),
	fileKey: key.nullable(),
})

const librarySchema = z.object({
	key,
	name: libraryNameSchema,
	description: libraryDescriptionSchema.nullable(),
	lorebook: lorebookSchema.nullable(),
	entries: z.array(entrySchema).max(PACKAGE_LIMITS.entries, `A library in a listing holds at most ${PACKAGE_LIMITS.entries} files, notes and folders`),
})

/** A chat setup, shaped as a folder's defaults (`folderDefaultsSchema`) with keys for ids, and lanes as their own fields. */
const autoFetchSchema = chatSettingsSchema.shape.autoFetch.unwrap()
const setupSchema = z.object({
	models: z.array(laneFieldsSchema.omit({ characterId: true }).partial().extend({ characterKey: key.nullable().optional() })).min(1).max(12).optional(),
	mode: z.enum(['separate', 'group']).optional(),
	libraryKeys: z.array(key).max(5),
	structureProfileKey: key.nullable(),
	/** Absent: the member's own default, as in a folder's defaults. */
	userCharacterKey: key.nullable().optional(),
	/** Auto-fetch's folders are entry keys. */
	settings: chatSettingsSchema.extend({ autoFetch: autoFetchSchema.extend({ folders: z.array(key).max(50).optional() }).optional() }).optional(),
})

export const packageSchema = z.object({
	characters: z.array(characterSchema).max(PACKAGE_LIMITS.characters, `A listing holds at most ${PACKAGE_LIMITS.characters} Characters`),
	libraries: z.array(librarySchema).max(PACKAGE_LIMITS.libraries, `A listing holds at most ${PACKAGE_LIMITS.libraries} libraries`),
	structureProfiles: z.array(structureProfileFieldsSchema.extend({ key })).max(PACKAGE_LIMITS.structureProfiles, `A listing holds at most ${PACKAGE_LIMITS.structureProfiles} structure profiles`),
	files: z.array(fileSchema),
	setup: setupSchema.nullable(),
}).superRefine((content, context) => {
	const problem = (message: string) => context.addIssue({ code: 'custom', message })
	if (!content.characters.length && !content.libraries.length && !content.structureProfiles.length && !content.setup) problem('There is nothing to publish')
	// Every key once; every reference to a key of its kind; every file used once.
	const keys: Record<string, string> = {}
	const add = (kind: string, value: string) => keys[value] ? problem(`The key ${value} is used twice`) : keys[value] = kind
	content.files.forEach(file => add('file', file.key))
	content.characters.forEach(character => add('character', character.key))
	content.structureProfiles.forEach(profile => add('profile', profile.key))
	content.libraries.forEach(library => add('library', library.key))
	const entryLibrary: Record<string, string> = {}
	for (const library of content.libraries) {
		for (const entry of library.entries) {
			add('entry', entry.key)
			entryLibrary[entry.key] = library.key
			if (entry.parentKey && (entryLibrary[entry.parentKey] !== library.key || library.entries.find(other => other.key === entry.parentKey)?.kind !== 'folder')) problem(`The entry ${entry.key} is not after its folder`)
			if ((entry.kind === 'file') !== !!entry.fileKey || (entry.kind === 'note') !== (entry.content !== null)) problem(`The entry ${entry.key} does not match its kind`)
		}
	}
	const used: Record<string, true> = {}
	const refer = (kind: string, value: string | null | undefined) => {
		if (!value) return
		if (keys[value] !== kind) problem(`The ${kind} ${value} is not in the package`)
		if (kind !== 'file') return
		if (used[value]) problem(`The file ${value} is used twice`)
		used[value] = true
	}
	for (const character of content.characters) {
		refer('file', character.avatarKey)
		character.libraryKeys.forEach(value => refer('library', value))
	}
	content.libraries.forEach(library => library.entries.forEach(entry => refer('file', entry.fileKey)))
	content.files.forEach(file => !used[file.key] && problem(`The file ${file.key} is used by nothing`))
	if (content.setup) {
		content.setup.models?.forEach(lane => refer('character', lane.characterKey))
		content.setup.libraryKeys.forEach(value => refer('library', value))
		refer('profile', content.setup.structureProfileKey)
		refer('character', content.setup.userCharacterKey)
		content.setup.settings?.autoFetch?.folders?.forEach(value => refer('entry', value))
	}
	if (packageSize(content) > PACKAGE_LIMITS.bytes) problem(`A listing can be at most ${PACKAGE_LIMITS.bytes / 1024 / 1024} MB with its files`)
})

export type Package = z.infer<typeof packageSchema>
export type PackageInput = z.input<typeof packageSchema>

/** A package's weight: its JSON and its files. */
export function packageSize(content: Pick<Package, 'files'>) {
	return new TextEncoder().encode(JSON.stringify(content)).length + content.files.reduce((sum, file) => sum + file.size, 0)
}

/** What a package is taken from: the member's items by id, or a Content Package (its items and setup). */
export const packageSourceSchema = z.object({
	characterIds: z.array(z.uuid()).max(PACKAGE_LIMITS.characters).optional(),
	libraryIds: z.array(z.uuid()).max(PACKAGE_LIMITS.libraries).optional(),
	structureProfileIds: z.array(z.uuid()).max(PACKAGE_LIMITS.structureProfiles).optional(),
	packageId: z.uuid().optional(),
}).strict()

export type PackageSource = z.infer<typeof packageSourceSchema>

/** The copies a member got from a package. */
export interface PackageCopies {
	characterIds: string[]
	libraryIds: string[]
	structureProfileIds: string[]
	folderId: string | null
}

/** A listing's kind, by what it is taken from: one item is that item's kind; a package or several items, a pack. */
export function listingKind(source: PackageSource) {
	const counts = [source.characterIds?.length ?? 0, source.libraryIds?.length ?? 0, source.structureProfileIds?.length ?? 0]
	if (source.packageId || counts.reduce((sum, count) => sum + count, 0) !== 1) return 'pack' as const
	return counts[0] ? 'character' as const : counts[1] ? 'library' as const : 'structureProfile' as const
}

/** A listing's texts, as its publisher writes them. */
export const listingTextsSchema = z.object({
	name: z.string().trim().min(1).max(80),
	summary: z.string().trim().max(200),
	description: z.string().trim().max(20_000),
	tags: z.array(z.string().trim().toLowerCase().min(1).max(30)).max(5, 'At most 5 tags').transform(tags => [...new Set(tags)]),
	category: z.string().trim().min(1).max(40).nullable(),
})

const ids = (max: number) => z.array(z.uuid()).max(max).transform(list => [...new Set(list)])
/** A Content Package's items (milestone 17): the member's own Characters, libraries and structure profiles, within a listing's limits. */
export const packageItemsSchema = z.object({
	characterIds: ids(PACKAGE_LIMITS.characters),
	libraryIds: ids(PACKAGE_LIMITS.libraries),
	structureProfileIds: ids(PACKAGE_LIMITS.structureProfiles),
}).strict()
export type PackageItems = z.infer<typeof packageItemsSchema>
export const NO_PACKAGE_ITEMS: PackageItems = { characterIds: [], libraryIds: [], structureProfileIds: [] }

/** A Content Package's texts while it is a draft: a listing's, but for the name, which is the package's own. */
export const packageTextsSchema = listingTextsSchema.omit({ name: true })
export type PackageTexts = z.infer<typeof packageTextsSchema>
export const NO_PACKAGE_TEXTS: PackageTexts = { summary: '', description: '', tags: [], category: null }

export const PUBLISHING_MODES = ['open', 'reviewed', 'off'] as const

/** Explore's instance settings, kept by admins and moderators (milestone 13 plan, section 3; modes, milestone 14). */
export const exploreSettingsSchema = z.object({
	/**
	 * `open`: published at once. `reviewed`: each publication waits for an admin's or moderator's approval. `off`:
	 * members browse and get, but only admins and moderators publish. Stored as a boolean before milestone 14: on and off.
	 */
	publishing: z.preprocess(value => value === true ? 'open' : value === false ? 'off' : value, z.enum(PUBLISHING_MODES)),
	/** The categories a listing may pick one of. */
	categories: z.array(z.string().trim().min(1).max(40)).max(30).transform(names => [...new Set(names)]),
	/** The most a listing may weigh with its files; at most the package limit. */
	maxSizeMb: z.number().int().min(1).max(PACKAGE_LIMITS.bytes / 1024 / 1024),
})

export type ExploreSettings = z.infer<typeof exploreSettingsSchema>
export const EXPLORE_DEFAULTS: ExploreSettings = { publishing: 'open', categories: [], maxSizeMb: PACKAGE_LIMITS.bytes / 1024 / 1024 }
