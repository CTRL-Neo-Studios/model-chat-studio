import { z } from 'zod'

const id = z.string().min(1).max(64)

/**
 * One block of a structure profile, in the order sent:
 * - `message`: a message the profile writes (`system` blocks at the very start join the instructions; later ones go
 *   as user messages, since the AI SDK takes system messages only as instructions);
 * - `history`: the chat's thread, as the memory setting cuts it; exactly one;
 * - `autoFetch`: where auto-fetched files go; at most one (without it they go at the end);
 * - `files`: library files, notes or folders by path, always sent; a path the chat's library does not have is skipped;
 * - `userCharacter`: where the user's Character goes; at most one (without it, after the instructions);
 * - `participants`: in group chats, who the speaker is and who else is here; at most one (without it, at the end of
 *   the instructions). Both join the instructions when they sit among the leading `system` messages.
 */
export const profileBlockSchema = z.discriminatedUnion('kind', [
	z.object({ id, kind: z.literal('message'), role: z.enum(['system', 'user', 'assistant']), text: z.string().max(50_000) }),
	z.object({ id, kind: z.literal('history') }),
	z.object({ id, kind: z.literal('autoFetch') }),
	z.object({ id, kind: z.literal('files'), paths: z.array(z.string().trim().min(1).max(2000)).max(50) }),
	z.object({ id, kind: z.literal('userCharacter') }),
	z.object({ id, kind: z.literal('participants') }),
])

export type ProfileBlock = z.infer<typeof profileBlockSchema>

export const profileBlocksSchema = z.array(profileBlockSchema).min(1).max(30)
	.refine(blocks => blocks.filter(block => block.kind === 'history').length === 1, 'A profile has exactly one history block')
	.refine(blocks => blocks.filter(block => block.kind === 'autoFetch').length <= 1, 'A profile has at most one auto-fetch block')
	.refine(blocks => blocks.filter(block => block.kind === 'userCharacter').length <= 1, 'A profile has at most one "your Character" block')
	.refine(blocks => blocks.filter(block => block.kind === 'participants').length <= 1, 'A profile has at most one participants block')

export const structureProfileFieldsSchema = z.object({
	name: z.string().trim().min(1).max(100),
	blocks: profileBlocksSchema,
})

type TemplateBlock = ProfileBlock extends infer Block ? Block extends ProfileBlock ? Omit<Block, 'id'> : never : never

/** Starting points for a new profile: blank, the brief's two examples, and one for group chats. Block ids are added on use. */
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
	{
		label: 'Group',
		name: 'Group',
		blocks: [
			{ kind: 'participants' },
			{ kind: 'userCharacter' },
			{ kind: 'message', role: 'system', text: 'Keep your part short and build on what the others said; leave their parts to them.' },
			{ kind: 'history' },
			{ kind: 'autoFetch' },
		],
	},
]