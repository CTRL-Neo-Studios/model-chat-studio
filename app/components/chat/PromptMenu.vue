<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

const props = withDefaults(defineProps<{
	/** Whether any answering model can search the web. */
	webSearchAvailable: boolean
	/** Opens the file picker of the prompt. */
	open: () => void
	/** The chat's switches (web search, images): its owner's to change; an editor gets only the files item. */
	switches?: boolean
}>(), { switches: true })

defineShortcuts({
	meta_u: { usingInput: true, handler: () => props.open() },
})

const webSearch = defineModel<boolean | undefined>('webSearch')
/** The chat's "Images" switch. */
const images = defineModel<boolean | undefined>('images')

// Images are drawn on OpenRouter whichever platform answers; the switch says why when it cannot.
const { images: imagesState, platform } = useModels()
const imagesNote = computed(() => {
	if (!imagesState.value.available) return imagesState.value.reason ?? undefined
	// DeepSeek takes no app tools next to web search with thinking off (milestone 4).
	if (platform.value?.id === 'deepseek' && webSearch.value) return 'With web search on, DeepSeek models draw only while thinking is on.'
	return 'The model draws when you ask for a picture.'
})

const items = computed<DropdownMenuItem[][]>(() => [[{
	label: 'Add files or photos',
	icon: 'i-lucide-paperclip',
	kbds: ['meta', 'U'],
	onSelect: () => props.open(),
}], props.switches
	? [
			...(props.webSearchAvailable
				? [{
						label: 'Web search',
						icon: 'i-lucide-globe',
						type: 'checkbox' as const,
						checked: !!webSearch.value,
						onUpdateChecked: (checked: boolean) => {
							webSearch.value = checked
						},
						onSelect: (e: Event) => e.preventDefault(),
					}]
				: []),
			{
				label: 'Images',
				icon: 'i-lucide-image',
				description: imagesNote.value,
				type: 'checkbox' as const,
				checked: !!images.value && imagesState.value.available,
				disabled: !imagesState.value.available,
				onUpdateChecked: (checked: boolean) => {
					images.value = checked
				},
				onSelect: (e: Event) => e.preventDefault(),
			},
		]
	: []].filter(group => group.length))
</script>

<template>
	<UDropdownMenu
		:items="items"
		:content="{ side: 'top', align: 'start', alignOffset: -4 }"
		:ui="{ content: 'w-64', itemDescription: 'whitespace-normal' }"
		size="sm"
	>
		<UButton
			icon="i-lucide-plus"
			color="neutral"
			variant="ghost"
			size="sm"
			aria-label="Open prompt menu"
			class="data-[state=open]:bg-elevated"
		/>
	</UDropdownMenu>
</template>
