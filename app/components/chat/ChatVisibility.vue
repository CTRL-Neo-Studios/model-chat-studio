<script setup lang="ts">
interface Person {
	id: string
	username: string
	name: string | null
	avatarUrl: string | null
}

const props = defineProps<{
	chatId: string
}>()

/** Link access: `public` lets anyone with the link read the chat. */
const visibility = defineModel<'public' | 'private'>('visibility', { required: true })
/** The people the chat is shared with, read-only. */
const sharedWith = defineModel<Person[]>('sharedWith', { required: true })

const toast = useToast()
const { csrf, headerName } = useCsrf()
const { copy, copied } = useClipboard({ copiedDuring: 2000 })

const saving = ref(false)
const shareUrl = computed(() => `${window.location.origin}/chat/${props.chatId}`)

/** Saves one change; the previous value comes back if the server refuses it. */
async function update<T>(target: Ref<T>, value: T, body: Record<string, unknown>) {
	const previous = target.value
	target.value = value
	saving.value = true
	try {
		await $fetch(`/api/v1/chats/${props.chatId}`, { method: 'PATCH', headers: { [headerName]: csrf }, body })
	}
	catch {
		target.value = previous
		toast.add({ description: 'Failed to update sharing', icon: 'i-lucide-alert-circle', color: 'error' })
	}
	finally {
		saving.value = false
	}
}

function setPeople(people: Person[]) {
	return update(sharedWith, people, { sharedWith: people.map(person => person.id) })
}

function setLinkAccess(on: boolean) {
	const value = on ? 'public' : 'private'
	return update(visibility, value, { visibility: value })
}

// People search: at least two characters, the server returns up to ten matches.
const searchTerm = ref('')
const results = ref<Person[]>([])
const searching = ref(false)
watchDebounced(searchTerm, async (term) => {
	if (term.trim().length < 2) {
		results.value = []
		return
	}
	searching.value = true
	try {
		results.value = await $fetch<Person[]>('/api/v1/users/search', { query: { q: term.trim() } })
	}
	catch {
		results.value = []
	}
	finally {
		searching.value = false
	}
}, { debounce: 250 })

const items = computed(() => results.value
	.filter(person => !sharedWith.value.some(shared => shared.id === person.id))
	.map(person => ({
		label: person.name || person.username,
		description: `@${person.username}`,
		avatar: { src: person.avatarUrl || undefined, alt: person.username },
		person,
	})))

function add(item: { person: Person } | undefined) {
	if (!item) return
	searchTerm.value = ''
	setPeople([...sharedWith.value, item.person])
}
</script>

<template>
	<UModal title="Share chat" description="People you add can read this chat. Only you can send messages in it." close>
		<UTooltip text="Share chat">
			<UChip :show="visibility === 'public' || sharedWith.length > 0" size="sm" inset>
				<UButton color="neutral" variant="ghost" icon="i-lucide-share" aria-label="Share chat" />
			</UChip>
		</UTooltip>

		<template #body>
			<div class="flex flex-col gap-5">
				<!-- Remounted after each change, so the input empties instead of showing the person just added. -->
				<UInputMenu
					:key="sharedWith.length"
					v-model:search-term="searchTerm"
					:items="items"
					:loading="searching"
					ignore-filter
					:reset-search-term-on-blur="false"
					icon="i-lucide-user-plus"
					placeholder="Add people by name or username"
					:disabled="saving"
					class="w-full"
					@update:model-value="add($event as { person: Person } | undefined)"
				>
					<template #empty>
						{{ searchTerm.trim().length < 2 ? 'Type at least two characters.' : 'Nobody found.' }}
					</template>
				</UInputMenu>

				<div class="flex flex-col gap-1">
					<p class="text-sm font-medium text-highlighted">
						People with access
					</p>
					<p v-if="!sharedWith.length" class="text-sm text-muted">
						Nobody yet.
					</p>
					<div v-for="person in sharedWith" :key="person.id" class="flex items-center gap-3 py-1">
						<UAvatar :src="person.avatarUrl || undefined" :alt="person.username" size="sm" />
						<div class="flex-1 min-w-0">
							<p class="text-sm text-highlighted truncate">
								{{ person.name || person.username }}
							</p>
							<p class="text-xs text-muted truncate">
								@{{ person.username }}
							</p>
						</div>
						<UButton
							icon="i-lucide-x"
							size="xs"
							color="neutral"
							variant="ghost"
							:disabled="saving"
							:aria-label="`Remove ${person.username}`"
							@click="setPeople(sharedWith.filter(shared => shared.id !== person.id))"
						/>
					</div>
				</div>

				<USeparator />

				<USwitch
					:model-value="visibility === 'public'"
					:disabled="saving"
					label="Anyone with the link"
					description="Anyone with the link can read this chat, without signing in."
					@update:model-value="setLinkAccess($event)"
				/>

				<div class="flex items-center gap-2 rounded-lg ring ring-default px-2 py-1.5">
					<span class="flex-1 truncate text-sm text-muted pl-1">{{ shareUrl }}</span>
					<UButton
						:label="copied ? 'Copied!' : 'Copy link'"
						size="sm"
						color="neutral"
						:variant="copied ? 'soft' : 'solid'"
						class="min-w-[72px] justify-center"
						@click="copy(shareUrl)"
					/>
				</div>
			</div>
		</template>
	</UModal>
</template>
