import { isToday, isYesterday, subDays, subMonths } from 'date-fns'

export interface UIChat {
	id: string
	label: string
	to: string
	icon: string
	createdAt: string
	/** `null` is no folder. */
	folderId: string | null
}

/** A chat of `GET /chats` as the lists show it. */
export function toUIChat(chat: { id: string, title: string | null, createdAt: string, folderId: string | null }): UIChat {
	return { id: chat.id, label: chat.title || 'Untitled', to: `/chat/${chat.id}`, icon: 'i-lucide-message-circle', createdAt: chat.createdAt, folderId: chat.folderId }
}

interface ChatGroup {
	id: string
	label: string
	items: UIChat[]
}

/** Groups chats (newest first) into Today, Yesterday, Last week, Last month, then one group per month. */
export function useChats(chats: Ref<UIChat[] | undefined>) {
	const groups = computed(() => {
		const oneWeekAgo = subDays(new Date(), 7)
		const oneMonthAgo = subMonths(new Date(), 1)
		const result: ChatGroup[] = []

		for (const chat of chats.value ?? []) {
			const date = new Date(chat.createdAt)
			const label = isToday(date)
				? 'Today'
				: isYesterday(date)
					? 'Yesterday'
					: date >= oneWeekAgo
						? 'Last week'
						: date >= oneMonthAgo
							? 'Last month'
							: date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
			// The list is sorted, so each group's chats are contiguous.
			const last = result[result.length - 1]
			if (last?.label === label) last.items.push(chat)
			else result.push({ id: label.toLowerCase().replace(/\s+/g, '-'), label, items: [chat] })
		}
		return result
	})

	return { groups }
}
