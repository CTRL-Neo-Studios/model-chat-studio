<script setup lang="ts">
import type { OwnListing } from '~/composables/useListingActions'

/** Where a publisher's listing stands, when it needs saying: removed with its reason, a version waiting, or rejected. */
const props = defineProps<{ listing: OwnListing }>()
const { update } = useListingActions()

/** A waiting version's earlier rejection, kept beside it. */
const earlierReason = computed(() => props.listing.versions[1]?.status === 'rejected' ? props.listing.versions[1].reason : null)
</script>

<template>
	<UAlert v-if="listing.status === 'removed'" color="error" variant="subtle" icon="i-lucide-shield-alert" title="Removed by a moderator" :description="listing.statusReason ?? undefined" />
	<UAlert
		v-else-if="listing.versions[0]?.status === 'pending'"
		color="info"
		variant="subtle"
		icon="i-lucide-hourglass"
		:title="`Version ${listing.versions[0].number} is waiting for review`"
		:description="[listing.version ? `Version ${listing.version} stays on Explore meanwhile.` : 'It shows on Explore once an admin or moderator approves it.', earlierReason ? `Rejected before: ${earlierReason}` : ''].join(' ').trim()"
	/>
	<UAlert
		v-else-if="listing.versions[0]?.status === 'rejected'"
		color="error"
		variant="subtle"
		icon="i-lucide-circle-x"
		:title="`Rejected: ${listing.versions[0].reason}`"
		:description="listing.version ? `Version ${listing.version} stays on Explore. Change what is needed and publish again.` : 'It is not on Explore. Change what is needed and publish again.'"
		:actions="[{ label: 'Publish again…', icon: 'i-lucide-telescope', color: 'error', variant: 'subtle', onClick: () => update(listing, true) }]"
	/>
</template>
