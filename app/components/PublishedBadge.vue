<script setup lang="ts">
import type { PackageSource } from '#shared/utils/package'

// Where an item's listing stands on Explore, beside the item; nothing when it was never published.
const props = defineProps<{ source: PackageSource }>()
const { listingOf } = useMyListings()
const state = computed(() => {
	const listing = listingOf(props.source)
	return listing && listingState(listing)
})
</script>

<template>
	<UBadge v-if="state" :label="state.label" :color="state.color" icon="i-lucide-telescope" variant="subtle" size="sm" />
</template>
