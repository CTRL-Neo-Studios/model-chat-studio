import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { db } from 'hub:db'
import { libraryAbilities } from '#shared/abilities/libraryAbilities'
import { authorize } from '#server/utils/core/authorize'
import { findLibrary, listEntries } from '#server/utils/library/libraries'

/** The library's files as a flat list; the client builds the tree from `parentId`. */
export default defineEventHandler(async (event) => {
	const library = await findLibrary(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, libraryAbilities().readLibrary, library)
	return await listEntries(db, library!.id)
})
