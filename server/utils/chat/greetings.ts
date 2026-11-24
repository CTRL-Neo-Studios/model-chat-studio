// Relative, not `#shared`, so this module also loads in `bun test`.
import { fillPlaceholders } from '../../../shared/utils/character'
import type { LaneColor, MessageMetadata } from '../../../shared/utils/chat'

interface GreetingLane { id: string, enabled: boolean, color: LaneColor | null, characterId: string | null }
interface GreetingCharacter { name: string, color: LaneColor | null, greetings: string[] }

/**
 * The answers a new chat opens with: each lane whose Character has greetings greets, the first greeting shown and
 * the others as its versions, with `{{char}}` and `{{user}}` filled. In a group chat only the first lane that has
 * one greets. A greeting answers no message (`parentId` null), so it comes before the first message.
 */
export function greetingMessages(input: { chatId: string, lanes: GreetingLane[], characters: Record<string, GreetingCharacter>, userName: string, group: boolean }) {
	const greeting = input.lanes.filter(lane => lane.enabled && lane.characterId && input.characters[lane.characterId]?.greetings.length)
	return (input.group ? greeting.slice(0, 1) : greeting).flatMap((lane) => {
		const character = input.characters[lane.characterId!]!
		const metadata: MessageMetadata = { greeting: true, lane: { name: character.name, color: lane.color ?? character.color } }
		return character.greetings.map((text, index) => ({
			id: crypto.randomUUID(),
			chatId: input.chatId,
			role: 'assistant' as const,
			parentId: null,
			chatModelId: lane.id,
			active: index === 0,
			parts: [{ type: 'text' as const, text: fillPlaceholders(text, { char: character.name, user: input.userName }) }],
			metadata,
		}))
	})
}
