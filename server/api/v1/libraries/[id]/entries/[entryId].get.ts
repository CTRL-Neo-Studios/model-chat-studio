import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { db } from 'hub:db'
import { libraryAbilities } from '#shared/abilities/libraryAbilities'
import { authorize } from '#server/utils/core/authorize'
import { findEntry, findLibrary } from '#server/utils/library/libraries'

/** One entry with a note's text, which the list leaves out. */
export default defineEventHandler(async (event) => {
	const library = await findLibrary(db, getRouterParam(event, 'id', { decode: true }))
	await authorize(event, libraryAbilities().readLibrary, library)
	const entry = await findEntry(db, library!.id, getRouterParam(event, 'entryId', { decode: true }))
	if (!entry) throw createError({ status: 404, statusText: 'Entry not found' })
	return entry
})
