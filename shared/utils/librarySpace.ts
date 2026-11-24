/** A library a chat reads, as paths need it. */
export interface LibraryRef { id: string, name: string }

interface PathNode { id: string, parentId: string | null, name: string }

/** Each entry's path in its library: folder names and its own, joined by `/`. */
export function entryPaths(entries: PathNode[]): Record<string, string> {
	const byId = Object.fromEntries(entries.map(entry => [entry.id, entry]))
	const paths: Record<string, string> = {}
	const pathOf = (entry: PathNode, depth: number): string => {
		const parent = entry.parentId ? byId[entry.parentId] : undefined
		// Bounded, so a cycle left by two concurrent moves cannot loop forever.
		return parent && depth < entries.length ? `${paths[parent.id] ?? pathOf(parent, depth + 1)}/${entry.name}` : entry.name
	}
	for (const entry of entries) paths[entry.id] = pathOf(entry, 0)
	return paths
}

/**
 * The entries of a chat's libraries (`lists`, one per library, in attach order), each with its `path` as models and
 * people see it: with more than one library, the path starts with its library's name, so the same path in two
 * libraries stays apart. `localPath` is the path inside its own library.
 */
export function spaceEntries<T extends PathNode>(libraries: LibraryRef[], lists: T[][]) {
	return libraries.flatMap((library, index) => {
		const entries = lists[index] ?? []
		const paths = entryPaths(entries)
		const prefix = libraries.length > 1 ? `${library.name}/` : ''
		return entries.map(entry => ({ ...entry, libraryId: library.id, localPath: paths[entry.id]!, path: prefix + paths[entry.id]! }))
	})
}

/**
 * Finds an entry of the space by path, case-insensitive, with or without slashes at the ends. `Library/path` looks
 * in that library first; otherwise each library is tried in attach order, so a path two libraries share finds the
 * first one's.
 */
export function spaceResolver<T extends { libraryId: string, localPath: string }>(libraries: LibraryRef[], entries: T[]) {
	const byLibrary: Record<string, Record<string, T>> = {}
	for (const entry of entries) (byLibrary[entry.libraryId] ??= {})[entry.localPath.toLowerCase()] = entry
	return (path: string): T | undefined => {
		const clean = path.replace(/^\/+|\/+$/g, '').toLowerCase()
		for (const library of libraries) {
			const prefix = `${library.name.toLowerCase()}/`
			const found = clean.startsWith(prefix) ? byLibrary[library.id]?.[clean.slice(prefix.length)] : undefined
			if (found) return found
		}
		for (const library of libraries) {
			const found = byLibrary[library.id]?.[clean]
			if (found) return found
		}
		return undefined
	}
}
