<script setup lang="ts">
import { AUTO_FETCH_DEFAULTS, type AutoFetchSettings, type ChatSettings } from '#shared/utils/chat'

/**
 * A project chat's project settings, in the prompt's footer: auto-fetch and the file tools. Changes are kept while
 * the popover is open and saved when it closes, so a number stepped up five times is one save.
 */
const props = defineProps<{
	projectId: string
	settings: ChatSettings
}>()

const emit = defineEmits<{ change: [Pick<ChatSettings, 'autoFetch' | 'fileTools'>] }>()

const current = computed(() => ({
	autoFetch: { ...AUTO_FETCH_DEFAULTS, ...props.settings.autoFetch } satisfies AutoFetchSettings,
	fileTools: props.settings.fileTools !== false,
}))
const draft = ref(structuredClone(toRaw(current.value)))
function onOpen(open: boolean) {
	if (open) draft.value = structuredClone(toRaw(current.value))
	else if (JSON.stringify(draft.value) !== JSON.stringify(current.value)) emit('change', structuredClone(toRaw(draft.value)))
}

const roles = [
	{ label: 'Your messages', value: 'user' },
	{ label: 'Answers', value: 'assistant' },
	{ label: 'System prompt', value: 'system' },
]
const scan = computed({
	get: () => draft.value.autoFetch.scan,
	// At least one role is searched.
	set: (value: string[]) => {
		const next = value.filter((role): role is AutoFetchSettings['scan'][number] => role === 'user' || role === 'assistant' || role === 'system')
		if (next.length) draft.value.autoFetch.scan = next
	},
})

const { data: entryList } = useQuery(() => projectEntriesQuery(props.projectId))
const folders = computed(() => {
	const entries = entryList.value ?? []
	const byId = Object.fromEntries(entries.map(entry => [entry.id, entry]))
	const pathOf = (id: string, depth = 0): string => {
		const entry = byId[id]
		return entry?.parentId && depth < entries.length ? `${pathOf(entry.parentId, depth + 1)}/${entry.name}` : entry?.name ?? ''
	}
	return entries.filter(entry => entry.kind === 'folder').map(entry => ({ label: pathOf(entry.id), value: entry.id })).sort((a, b) => a.label.localeCompare(b.label))
})

const label = computed(() => {
	const on = [current.value.autoFetch.enabled && 'auto-fetch', current.value.fileTools && 'file tools'].filter(Boolean)
	return on.length ? `Project: ${on.join(', ')}` : 'Project: off'
})
</script>

<template>
	<UPopover :content="{ side: 'top', align: 'start' }" @update:open="onOpen">
		<UButton :label="label" icon="i-lucide-folder-kanban" color="neutral" variant="ghost" size="sm" :class="label !== 'Project: off' && 'text-highlighted'" />
		<template #content>
			<div class="w-80 p-3 flex flex-col gap-3 max-h-[70vh] overflow-y-auto">
				<USwitch v-model="draft.fileTools" label="Let models look through the files" description="Models that take tools can list, search and read the project's notes and text files when they need to." />
				<USeparator />
				<USwitch v-model="draft.autoFetch.enabled" label="Fetch matching project files" description="Files and notes whose tags appear in the conversation are sent with each answer." />
				<template v-if="draft.autoFetch.enabled">
					<UFormField label="Search in">
						<UToggleGroup v-model="scan" type="multiple" :items="roles" size="xs" variant="outline" class="flex-wrap" />
					</UFormField>
					<div class="grid grid-cols-2 gap-3">
						<UFormField label="Latest messages searched">
							<UInputNumber v-model="draft.autoFetch.scanMessages" :min="1" :max="50" size="sm" />
						</UFormField>
						<UFormField label="Most files per answer">
							<UInputNumber v-model="draft.autoFetch.maxEntries" :min="1" :max="20" size="sm" />
						</UFormField>
					</div>
					<UFormField label="Most characters of text" help="Images and PDFs do not count.">
						<UInputNumber v-model="draft.autoFetch.maxChars" :min="1000" :max="500000" :step="5000" size="sm" />
					</UFormField>
					<UFormField label="Only from these folders" help="None chosen: the whole project.">
						<USelectMenu v-model="draft.autoFetch.folders" :items="folders" value-key="value" multiple placeholder="Whole project" size="sm" class="w-full" />
					</UFormField>
					<USwitch v-model="draft.autoFetch.fuzzy" label="Also match by name and text" description="Also fetches files whose names resemble the conversation's words (even with typos) or whose text has them." />
				</template>
			</div>
		</template>
	</UPopover>
</template>
