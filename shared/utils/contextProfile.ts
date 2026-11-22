import { z } from 'zod'

const id = z.string().min(1).max(64)

/**
 * One block of a context profile, in the order sent:
 * - `message`: a message the profile writes (`system` blocks at the very start join the instructions; later ones go
 *   as user messages, since the AI SDK takes system messages only as instructions);
 * - `history`: the chat's thread, as the memory setting cuts it; exactly one;
 * - `autoFetch`: where auto-fetched files go; at most one (without it they go at the end);
 * - `files`: project files, notes or folders by path, always sent; a path the project does not have is skipped.
 */
export const profileBlockSchema = z.discriminatedUnion('kind', [
	z.object({ id, kind: z.literal('message'), role: z.enum(['system', 'user', 'assistant']), text: z.string().max(50_000) }),
	z.object({ id, kind: z.literal('history') }),
	z.object({ id, kind: z.literal('autoFetch') }),
	z.object({ id, kind: z.literal('files'), paths: z.array(z.string().trim().min(1).max(2000)).max(50) }),
])

export type ProfileBlock = z.infer<typeof profileBlockSchema>

export const profileBlocksSchema = z.array(profileBlockSchema).min(1).max(30)
	.refine(blocks => blocks.filter(block => block.kind === 'history').length === 1, 'A profile has exactly one history block')
	.refine(blocks => blocks.filter(block => block.kind === 'autoFetch').length <= 1, 'A profile has at most one auto-fetch block')

export const contextProfileFieldsSchema = z.object({
	name: z.string().trim().min(1).max(100),
	blocks: profileBlocksSchema,
})

type TemplateBlock = ProfileBlock extends infer Block ? Block extends ProfileBlock ? Omit<Block, 'id'> : never : never

/** Starting points for a new profile: blank, and the brief's two examples. Block ids are added on use. */
export const PROFILE_TEMPLATES: { label: string, name: string, blocks: TemplateBlock[] }[] = [
	{ label: 'Blank', name: '', blocks: [{ kind: 'history' }] },
	{
		label: 'Roleplay',
		name: 'Roleplay',
		blocks: [
			{ kind: 'message', role: 'system', text: 'You are …' },
			{ kind: 'history' },
			{ kind: 'message', role: 'user', text: 'Stay in character.' },
			{ kind: 'autoFetch' },
		],
	},
	{
		label: 'Programming',
		name: 'Programming',
		blocks: [
			{ kind: 'history' },
			{ kind: 'message', role: 'system', text: 'Follow these programming conventions: …' },
			{ kind: 'message', role: 'system', text: 'Follow these naming conventions: …' },
			{ kind: 'message', role: 'system', text: 'Follow these testing conventions: …' },
			{ kind: 'files', paths: [] },
		],
	},
]