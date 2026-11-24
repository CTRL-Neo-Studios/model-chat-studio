<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

const props = defineProps<{
	/** Whether any answering model can search the web. */
	webSearchAvailable: boolean
	/** Opens the file picker of the prompt. */
	open: () => void
}>()

defineShortcuts({
	meta_u: { usingInput: true, handler: () => props.open() },
})

const webSearch = defineModel<boolean | undefined>('webSearch')

const items = computed<DropdownMenuItem[][]>(() => [[{
	label: 'Add files or photos',
	icon: 'i-lucide-paperclip',
	kbds: ['meta', 'U'],
	onSelect: () => props.open(),
}], [
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
]].filter(group => group.length))
</script>

<template>
	<UDropdownMenu
		:items="items"
		:content="{ side: 'top', align: 'start', alignOffset: -4 }"
		:ui="{ content: 'w-52' }"
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
