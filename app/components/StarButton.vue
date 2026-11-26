<script setup lang="ts">
/** A listing's star with its count: shown at once, back as it was if the server refuses. */
const props = defineProps<{ listingId: string, starred: boolean, stars: number, size?: 'xs' | 'sm' | 'md' }>()

const act = useApiAction()
const queryCache = useQueryCache()
const on = ref(props.starred)
const count = ref(props.stars)
watch(() => [props.starred, props.stars] as const, ([starred, stars]) => {
	on.value = starred
	count.value = stars
})
const busy = ref(false)

async function toggle() {
	if (busy.value) return
	busy.value = true
	const before = { on: on.value, count: count.value }
	on.value = !before.on
	count.value = before.count + (on.value ? 1 : -1)
	if (!await act(`/api/v1/explore/listings/${props.listingId}/star`, { method: on.value ? 'PUT' : 'DELETE' })) {
		on.value = before.on
		count.value = before.count
	}
	busy.value = false
	// The grid, the listing's page and the member's stars all show it.
	await Promise.all([queryCache.invalidateQueries({ key: ['explore'] }), queryCache.invalidateQueries({ key: myStarsQuery.key })])
}
</script>

<template>
	<UButton
		icon="i-lucide-star"
		:label="String(count)"
		:color="on ? 'warning' : 'neutral'"
		:variant="on ? 'soft' : 'ghost'"
		:size="size ?? 'xs'"
		:aria-label="on ? 'Remove your star' : 'Star'"
		:aria-pressed="on"
		@click="toggle"
	/>
</template>
