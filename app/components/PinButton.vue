<script setup lang="ts">
/** Pins an item to the top of its list, or unpins it. */
const props = defineProps<{
	kind: PinKind
	targetId: string
}>()

const { isPinned, togglePin } = usePins()
const pinned = computed(() => isPinned(props.kind, props.targetId))
</script>

<template>
	<UTooltip :text="pinned ? 'Unpin' : 'Pin to the top'">
		<UButton
			icon="i-lucide-pin"
			:color="pinned ? 'primary' : 'neutral'"
			variant="ghost"
			size="sm"
			:class="!pinned && 'text-dimmed'"
			:aria-label="pinned ? 'Unpin' : 'Pin to the top'"
			:aria-pressed="pinned"
			@click="togglePin(kind, targetId)"
		/>
	</UTooltip>
</template>
