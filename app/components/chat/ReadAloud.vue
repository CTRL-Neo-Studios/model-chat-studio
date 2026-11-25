<script setup lang="ts">
/** "Read aloud" under an answer, "Stop" while it is read. Hidden until read-aloud is set up on the active platform. */
const props = defineProps<{
	message: { id: string, parts: { type: string, text?: string }[] }
}>()

const { available, readingId, waiting, read, stop } = useReadAloud()
const playing = computed(() => readingId.value === props.message.id)
</script>

<template>
	<UTooltip v-if="available" :text="playing ? 'Stop reading' : 'Read aloud'">
		<UButton
			size="sm"
			:color="playing ? 'primary' : 'neutral'"
			variant="ghost"
			:icon="playing ? 'i-lucide-square' : 'i-lucide-volume-2'"
			:class="playing && waiting && 'animate-pulse'"
			:aria-label="playing ? 'Stop reading' : 'Read aloud'"
			@click="playing ? stop() : read(message.id, message.parts)"
		/>
	</UTooltip>
</template>
