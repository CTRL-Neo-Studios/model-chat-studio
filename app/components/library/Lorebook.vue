<script setup lang="ts">
import type { Lorebook } from '#shared/utils/lorebook'

/**
 * A library's lorebook switch and, under "Advanced", the book's options (milestone 9 plan, section 2b), in the
 * library's header. Changes are kept while the popover is open and saved when it closes. The owner changes them;
 * the others see whether it is on.
 */
const props = defineProps<{
	libraryId: string
	lorebook: Lorebook | null
	canManage: boolean
}>()

const act = useApiAction()
const queryCache = useQueryCache()

const current = computed(() => ({
	on: !!props.lorebook?.on,
	scanDepth: props.lorebook?.scanDepth ?? null,
	maxChars: props.lorebook?.maxChars ?? null,
	recursive: !!props.lorebook?.recursive,
}))
const draft = ref(structuredClone(toRaw(current.value)))
async function onOpen(open: boolean) {
	if (open) {
		draft.value = structuredClone(toRaw(current.value))
		return
	}
	if (JSON.stringify(draft.value) === JSON.stringify(current.value)) return
	const lorebook = structuredClone(toRaw(draft.value))
	const key = libraryQuery(props.libraryId).key
	const before = queryCache.getQueryData(key)
	if (before) queryCache.setQueryData(key, { ...before, lorebook: { ...before.lorebook, ...lorebook } })
	if (await act(`/api/v1/libraries/${props.libraryId}`, { method: 'PATCH', body: { lorebook } })) queryCache.invalidateQueries({ key: librariesQuery.key, exact: true })
	else if (before) queryCache.setQueryData(key, before)
}

/** The book's card fields kept for export, which nothing here uses. */
const kept = computed(() => Object.keys(props.lorebook?.kept ?? {}).join(', '))
</script>

<template>
	<UPopover v-if="canManage" :content="{ align: 'end' }" @update:open="onOpen">
		<UButton :label="current.on ? 'Lorebook' : 'Lorebook off'" icon="i-lucide-book-open-text" color="neutral" :variant="current.on ? 'subtle' : 'ghost'" size="sm" />
		<template #content>
			<div class="w-80 p-3 flex flex-col gap-3 max-h-[70vh] overflow-y-auto">
				<USwitch
					v-model="draft.on"
					label="Lorebook"
					description="Its notes are sent when their keywords come up, in your messages or the answers, and framed as what the Character knows. The file tools and auto-fetch leave it alone."
				/>
				<UCollapsible :unmount-on-hide="false" class="flex flex-col gap-3">
					<UButton label="Advanced" color="neutral" variant="ghost" size="sm" trailing-icon="i-lucide-chevron-down" class="self-start" :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform' }" />
					<template #content>
						<div class="flex flex-col gap-3 pt-1">
							<UFormField label="Latest messages searched" help="Empty: the chat's auto-fetch setting. A note can set its own.">
								<UInputNumber v-model="draft.scanDepth" :min="0" :max="100" placeholder="Chat's setting" size="sm" />
							</UFormField>
							<UFormField label="Most characters per answer" help="Notes over it are left out, lowest priority first. Empty: the chat's auto-fetch setting.">
								<UInputNumber v-model="draft.maxChars" :min="100" :max="500000" :step="1000" placeholder="Chat's setting" size="sm" />
							</UFormField>
							<USwitch v-model="draft.recursive" label="Search sent notes too" description="Keywords in the notes sent bring in more notes, at most three passes." />
							<p v-if="kept" class="text-xs text-muted">
								Kept from the card for export, not used here: {{ kept }}.
							</p>
						</div>
					</template>
				</UCollapsible>
			</div>
		</template>
	</UPopover>
	<UBadge v-else-if="current.on" label="Lorebook" icon="i-lucide-book-open-text" color="neutral" variant="subtle" />
</template>
