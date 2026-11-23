<script setup lang="ts">
/** `‹ 2/3 ›`: flips between an answer's versions or a message's branches, oldest first. */
const props = defineProps<{
	ids: string[]
	current: string
	/** "version" or "branch", for the labels. */
	noun: string
	disabled?: boolean
}>()

const emit = defineEmits<{ show: [id: string] }>()

const index = computed(() => props.ids.indexOf(props.current))
</script>

<template>
	<div class="flex items-center text-xs text-muted tabular-nums">
		<UButton icon="i-lucide-chevron-left" size="xs" color="neutral" variant="ghost" :aria-label="`Earlier ${noun}`" :disabled="disabled || index <= 0" @click="emit('show', ids[index - 1]!)" />
		<span :aria-label="`${noun[0]!.toUpperCase()}${noun.slice(1)} ${index + 1} of ${ids.length}`">{{ index + 1 }}/{{ ids.length }}</span>
		<UButton icon="i-lucide-chevron-right" size="xs" color="neutral" variant="ghost" :aria-label="`Later ${noun}`" :disabled="disabled || index === ids.length - 1" @click="emit('show', ids[index + 1]!)" />
	</div>
</template>
