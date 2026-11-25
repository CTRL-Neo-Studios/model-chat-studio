<script setup lang="ts">
/**
 * "Read aloud" under an answer, "Stop" while it is read. Hidden until read-aloud is set up on the active platform,
 * and on answers with nothing to read (only an image or a chart).
 */
import { speechText } from '#shared/utils/speech'

const props = defineProps<{
	message: { id: string, parts: { type: string, text?: string }[] }
}>()

const { available, readingId, waiting, read, stop } = useReadAloud()
const playing = computed(() => readingId.value === props.message.id)
const readable = computed(() => !!speechText(props.message.parts))
</script>

<template>
	<UTooltip v-if="available && readable" :text="playing ? 'Stop reading' : 'Read aloud'">
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
