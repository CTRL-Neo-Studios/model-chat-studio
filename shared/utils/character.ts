import { z } from 'zod'
import { LANE_COLORS, type LaneColor } from './chat'

/** The longest a Character's texts may be: cards bring long ones. */
export const CHARACTER_TEXT_MAX = 50_000
const text = z.string().trim().max(CHARACTER_TEXT_MAX)

/** The editable fields of a Character. Its libraries are read by its own lane only, in every chat it joins. */
export const characterFieldsSchema = z.object({
	name: z.string().trim().min(1).max(60),
	color: z.enum(LANE_COLORS).nullable(),
	instructions: text,
	libraryIds: z.array(z.uuid()).max(5).transform(ids => [...new Set(ids)]),
	/** Opening answers, the first shown first. */
	greetings: z.array(z.string().trim().min(1).max(CHARACTER_TEXT_MAX)).max(50),
	/** Example dialogue, sent after the instructions. */
	examples: text,
	/** Sent after the conversation on every turn. */
	note: text,
	/** Shown here, never sent to a model. */
	creatorNotes: text,
	tags: z.array(z.string().trim().min(1).max(50)).max(50).transform(tags => [...new Set(tags)]),
})

export type CharacterFields = z.infer<typeof characterFieldsSchema>

/**
 * Fills `{{char}}` (who the lane is) and `{{user}}` (who the user is) in instructions and structure profile messages,
 * as SillyTavern writes them: any case, spaces inside the braces allowed. Anything else in braces stays as it is.
 */
export function fillPlaceholders(text: string, names: { char: string, user: string }) {
	return text.replace(/\{\{\s*(char|user)\s*\}\}/gi, (_, key: string) => key.toLowerCase() === 'char' ? names.char : names.user)
}

interface LaneLike { name: string | null, color: LaneColor | null, systemPrompt: string | null }
interface CharacterLike { name: string, color: LaneColor | null, instructions: string, examples?: string, note?: string }

/**
 * Who a lane is in one turn: its Character's name and instructions (else its own name and prompt), its example
 * dialogue and closing note, the user's Character as a line about the user, and `{{char}}` and `{{user}}` filled in
 * all of them. An empty prompt uses the default instructions.
 */
export function laneIdentity(input: { lane: LaneLike, character?: CharacterLike | null, userCharacter?: Omit<CharacterLike, 'color'> | null, modelName: string, userName: string }) {
	const { lane, character, userCharacter } = input
	const names = { char: character?.name ?? lane.name ?? input.modelName, user: userCharacter?.name ?? input.userName }
	const own = character ? character.instructions : lane.systemPrompt
	const aboutUser = userCharacter && [`The user is ${userCharacter.name}.`, userCharacter.instructions.trim()].filter(Boolean).join('\n')
	const filled = (value: string | null | undefined) => value?.trim() ? fillPlaceholders(value, names) : undefined
	return {
		names,
		color: lane.color ?? character?.color ?? null,
		systemPrompt: filled(own) ?? null,
		promptLabel: character ? `Character ${character.name}` : 'System prompt',
		aboutUser: filled(aboutUser),
		examples: filled(character?.examples),
		closingNote: filled(character?.note),
	}
}

/** A Character's avatar, versioned by its file so a new one is fetched at once; nothing when it has none. */
export const characterAvatarUrl = (character: { id: string, avatarFileId: string | null }) =>
	character.avatarFileId ? `/api/v1/characters/${character.id}/avatar?v=${character.avatarFileId}` : undefined