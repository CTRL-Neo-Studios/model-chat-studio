import { z } from 'zod'
import { LANE_COLORS, type LaneColor } from './chat'

/** The editable fields of a Character. Its libraries are read by its own lane only, in every chat it joins. */
export const characterFieldsSchema = z.object({
	name: z.string().trim().min(1).max(60),
	color: z.enum(LANE_COLORS).nullable(),
	instructions: z.string().trim().max(20_000),
	libraryIds: z.array(z.uuid()).max(5).transform(ids => [...new Set(ids)]),
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
interface CharacterLike { name: string, color: LaneColor | null, instructions: string }

/**
 * Who a lane is in one turn: its Character's name and instructions (else its own name and prompt), the user's
 * Character as a line about the user, and `{{char}}` and `{{user}}` filled in all of them. An empty prompt uses the
 * default instructions.
 */
export function laneIdentity(input: { lane: LaneLike, character?: CharacterLike | null, userCharacter?: Omit<CharacterLike, 'color'> | null, modelName: string, userName: string }) {
	const { lane, character, userCharacter } = input
	const names = { char: character?.name ?? lane.name ?? input.modelName, user: userCharacter?.name ?? input.userName }
	const own = character ? character.instructions : lane.systemPrompt
	const aboutUser = userCharacter && [`The user is ${userCharacter.name}.`, userCharacter.instructions.trim()].filter(Boolean).join('\n')
	return {
		names,
		color: lane.color ?? character?.color ?? null,
		systemPrompt: own?.trim() ? fillPlaceholders(own, names) : null,
		promptLabel: character ? `Character ${character.name}` : 'System prompt',
		aboutUser: aboutUser ? fillPlaceholders(aboutUser, names) : undefined,
	}
}