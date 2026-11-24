<script setup lang="ts">
const folderId = useRoute().params.id as string

// The sidebar already holds every folder and chat, so a click from it shows the page at once; a reload shows
// skeletons until they load in the browser.
const { data: folderList, error } = useQuery(foldersQuery)
const { data: chatList } = useQuery(chatsQuery)
const chats = computed(() => (chatList.value ?? []).map(toUIChat))
const { isPinned } = usePins()
const { foldersIn, chatsIn, folderOf, ancestorsOf, editDefaults, folderActions, chatActions } = useFolderActions(() => chats.value)
const folder = computed(() => folderOf(folderId))
const subfolders = computed(() => foldersIn(folderId))
const folderChats = computed(() => chatsIn(folderId))
const breadcrumb = computed(() => folder.value && [
	...ancestorsOf(folderId).map(entry => ({ label: entry.name, icon: 'i-lucide-folder', to: `/folders/${entry.id}` })),
	{ label: folder.value.name, icon: 'i-lucide-folder-open' },
])
useHead({ title: () => folder.value?.name ?? 'Folder' })

// The defaults as a new chat here starts with them: the server's reading, also the prompt's.
const { data: start } = useQuery(folderStartQuery(folderId))
const { data: libraryList } = useQuery(librariesQuery)
const { data: structureList } = useQuery(structureProfilesQuery)
const { data: characterList } = useQuery(charactersQuery)
const { laneName, draft } = useChatLanes()
const nameIn = (list: { id: string, name: string }[] | undefined, id: string) => list?.find(entry => entry.id === id)?.name ?? '…'
const defaultRows = computed(() => {
	const defaults = start.value?.defaults
	if (!defaults) return []
	const webSearch = defaults.settings?.webSearch
	return [
		start.value?.lanes && { label: 'Models', value: start.value.lanes.map(lane => laneName(draft(lane))).join(', ') },
		defaults.mode && { label: 'Answers', value: defaults.mode === 'group' ? 'Group chat' : 'Separate answers' },
		defaults.userCharacterId !== undefined && { label: 'You are', value: defaults.userCharacterId ? nameIn(characterList.value, defaults.userCharacterId) : 'Nobody' },
		defaults.libraryIds.length && { label: 'Libraries', value: defaults.libraryIds.map(id => nameIn(libraryList.value, id)).join(', ') },
		defaults.structureProfileId && { label: 'Structure profile', value: nameIn(structureList.value, defaults.structureProfileId) },
		webSearch !== undefined && { label: 'Web search', value: webSearch ? 'On' : 'Off' },
	].flatMap(row => row || [])
})

// The prompt takes the defaults when it opens; when they change (edited here, or read again), it starts afresh.
const promptKey = ref(0)
watch(() => start.value && JSON.stringify(start.value.defaults), (now, before) => {
	if (before !== undefined && now !== before) promptKey.value++
})

const prefetch = usePrefetch()
const dateOf = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
</script>

<template>
	<UContainer v-if="error || (folderList && !folder)" class="flex-1 flex flex-col">
		<UError :error="{ statusMessage: 'Folder not found', statusCode: 404 }" class="min-h-full" />
	</UContainer>

	<NewChat v-else :key="promptKey" :folder-id="folderId">
		<template #heading>
			<div v-if="folder" class="flex flex-col gap-2 min-w-0">
				<UBreadcrumb v-if="ancestorsOf(folderId).length" :items="breadcrumb ?? []" />
				<div class="flex items-center gap-1 min-w-0">
					<h1 class="text-3xl sm:text-4xl text-highlighted font-bold truncate">
						{{ folder.name }}
					</h1>
					<UDropdownMenu :items="folderActions(folder)" :content="{ align: 'start' }">
						<UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" aria-label="Folder actions" />
					</UDropdownMenu>
				</div>
			</div>
			<USkeleton v-else class="h-10 w-1/3" aria-label="Loading the folder" />
		</template>

		<div v-if="folder" class="flex flex-col gap-6">
			<UCard :ui="{ header: 'flex items-center justify-between gap-2 py-3 sm:py-3', body: 'py-3 sm:py-3' }">
				<template #header>
					<div class="min-w-0">
						<h2 class="font-semibold text-highlighted">
							Defaults for new chats
						</h2>
						<p v-if="start?.from" class="text-sm text-muted">
							From <ULink :to="`/folders/${start.from.id}`" class="text-default">“{{ start.from.name }}”</ULink>, a folder above.
						</p>
					</div>
					<UButton :label="folder.defaults ? 'Edit…' : 'Set defaults…'" icon="i-lucide-folder-cog" color="neutral" variant="outline" size="sm" @click="editDefaults(folder)" />
				</template>
				<dl v-if="defaultRows.length" class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
					<template v-for="row in defaultRows" :key="row.label">
						<dt class="text-muted">
							{{ row.label }}
						</dt>
						<dd class="text-default">
							{{ row.value }}
						</dd>
					</template>
				</dl>
				<p v-else-if="start" class="text-sm text-muted">
					None: new chats here start as on the home page.
				</p>
				<USkeleton v-else class="h-5 w-2/3" />
			</UCard>

			<section v-if="subfolders.length" class="flex flex-col gap-2">
				<h2 class="text-sm font-semibold text-highlighted">
					Folders
				</h2>
				<ul class="divide-y divide-default rounded-md border border-default">
					<li v-for="entry in subfolders" :key="entry.id" class="flex items-center gap-2 ps-3 pe-1 py-1.5">
						<UIcon name="i-lucide-folder" class="size-4 shrink-0 text-dimmed" />
						<ULink :to="`/folders/${entry.id}`" class="flex-1 truncate text-default">
							{{ entry.name }}
						</ULink>
						<UIcon v-if="isPinned('chatFolder', entry.id)" name="i-lucide-pin" class="size-3 shrink-0 text-dimmed" aria-label="Pinned" />
						<UDropdownMenu :items="folderActions(entry)" :content="{ align: 'end' }">
							<UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="sm" aria-label="Folder actions" />
						</UDropdownMenu>
					</li>
				</ul>
			</section>

			<section class="flex flex-col gap-2">
				<h2 class="text-sm font-semibold text-highlighted">
					Chats
				</h2>
				<ul v-if="folderChats.length" class="divide-y divide-default rounded-md border border-default">
					<li
						v-for="chat in folderChats"
						:key="chat.id"
						class="flex items-center gap-2 ps-3 pe-1 py-1.5"
						@pointerenter="prefetch(chatQuery(chat.id))"
					>
						<ULink :to="chat.to" :class="['flex-1 truncate', chat.label === 'Untitled' ? 'text-muted' : 'text-default']">
							{{ chat.label }}
						</ULink>
						<UIcon v-if="isPinned('chat', chat.id)" name="i-lucide-pin" class="size-3 shrink-0 text-dimmed" aria-label="Pinned" />
						<span class="text-xs text-muted shrink-0">{{ dateOf(chat.createdAt) }}</span>
						<UDropdownMenu :items="chatActions(chat)" :content="{ align: 'end' }">
							<UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="sm" aria-label="Chat actions" />
						</UDropdownMenu>
					</li>
				</ul>
				<p v-else-if="chatList" class="text-sm text-muted">
					No chats here yet.
				</p>
				<div v-else class="flex flex-col gap-2">
					<USkeleton v-for="n in 3" :key="n" class="h-9 w-full" />
				</div>
			</section>
		</div>
		<div v-else class="flex flex-col gap-3" aria-busy="true" aria-label="Loading the folder">
			<USkeleton class="h-24 w-full rounded-lg" />
			<USkeleton v-for="n in 3" :key="n" class="h-9 w-full" />
		</div>
	</NewChat>
</template>
