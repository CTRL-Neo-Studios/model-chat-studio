<script setup lang="ts">
import type { LaneColor } from '#shared/utils/chat'

/** A lane's or Character's mark: its avatar, else its colour dot (dashed when it has no colour). */
withDefaults(defineProps<{
	color: LaneColor | null
	avatar?: string
	/** Size classes of the avatar, and of the dot. */
	avatarClass?: string
	dotClass?: string
}>(), { avatar: undefined, avatarClass: 'size-5', dotClass: 'size-2.5' })
</script>

<template>
	<img v-if="avatar" :src="avatar" alt="" :class="['rounded-full object-cover shrink-0', avatarClass]">
	<span v-else :class="['rounded-full shrink-0', dotClass, color ? LANE_COLOR_CLASSES[color] : 'border border-dashed border-accented']" />
</template>
