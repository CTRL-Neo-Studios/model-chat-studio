import type { EditorMentionMenuItem } from '@nuxt/ui'
import type { UIMessage } from 'ai'

const PREFIX = 'participant:'

/**
 * A group chat's participants for "@" in the prompt (they come before the library entries), and the `data-mention`
 * parts of the ones picked. Participants are named, not referred to by lane: a new chat's lanes have no ids yet.
 */
export function useParticipantMentions(names: MaybeRefOrGetter<string[]>) {
	const items = computed<EditorMentionMenuItem[]>(() => [...new Set(toValue(names))].map(name => ({
		id: `${PREFIX}${name}`,
		label: name,
		icon: 'i-lucide-user-round',
		description: 'answers',
	})))

	/** The `data-mention` parts for the participants named in the prompt, in the order written. */
	const partsFor = (ids: string[]) => ids.flatMap(id => id.startsWith(PREFIX) ? [{ type: 'data-mention' as const, data: { name: id.slice(PREFIX.length) } }] : [])

	return { items, partsFor }
}

/** What `POST /chats/:id/speakers` is asked about a message: its text and the participants it mentions. */
export function speakersQuestion(parts: UIMessage['parts']) {
	return {
		text: parts.map(part => part.type === 'text' ? part.text : '').join('\n'),
		mentions: parts.flatMap(part => part.type === 'data-mention' && typeof part.data === 'object' && part.data && 'name' in part.data && typeof part.data.name === 'string' ? [part.data.name] : []),
	}
}
