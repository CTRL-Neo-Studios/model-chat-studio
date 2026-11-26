import { z } from 'zod'

/** The editable fields of a library and its entries, as the routes and Explore's packages take them. */
export const libraryNameSchema = z.string().trim().min(1).max(100)
export const libraryDescriptionSchema = z.string().trim().max(2000)

/** Paths are folder names joined by `/`, so a name cannot hold one. */
export const entryNameSchema = z.string().trim().min(1).max(255)
	.refine(name => !name.includes('/') && name !== '.' && name !== '..', 'A name cannot contain "/" or be "." or ".."')

export const tagsSchema = z.array(z.string().trim().min(1).max(50)).max(20).transform(tags => [...new Set(tags)])

export const noteContentSchema = z.string().max(200_000)
