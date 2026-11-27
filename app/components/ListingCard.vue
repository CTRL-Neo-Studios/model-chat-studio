<script setup lang="ts">
import { formatDistanceToNow } from 'date-fns'

/** A listing as the grid and the stars page show it. */
export interface ListingCardData {
	id: string
	kind: keyof typeof LISTING_KINDS
	name: string
	summary: string
	tags: string[]
	featured: boolean
	gets: number
	stars: number
	starred: boolean
	available: boolean
	publishedAt: string | Date
	avatarFileId: string | null
	publisher: { username: string, name: string | null }
}

defineProps<{ listing: ListingCardData }>()
const emit = defineEmits<{ tag: [tag: string] }>()
</script>

<template>
	<li class="relative flex flex-col gap-2 rounded-md border border-default p-4 has-focus-visible:ring-2 has-focus-visible:ring-primary" :class="listing.available ? 'hover:bg-elevated/50' : 'opacity-70'">
		<div class="flex items-center gap-3 min-w-0">
			<UAvatar v-if="listing.avatarFileId" :src="`/api/v1/files/${listing.avatarFileId}`" :alt="listing.name" size="md" />
			<div v-else class="size-8 rounded-full bg-elevated flex items-center justify-center shrink-0">
				<UIcon :name="LISTING_KINDS[listing.kind].icon" class="size-4 text-muted" />
			</div>
			<!-- The link covers the card. -->
			<NuxtLink v-if="listing.available" :to="`/content/explore/${listing.id}`" class="font-medium text-highlighted truncate flex-1 outline-none after:absolute after:inset-0">
				{{ listing.name }}
			</NuxtLink>
			<span v-else class="font-medium text-muted truncate flex-1">{{ listing.name }}</span>
			<UBadge v-if="listing.featured && listing.available" label="Featured" icon="i-lucide-star" color="warning" variant="subtle" size="sm" />
		</div>
		<p v-if="!listing.available" class="text-sm text-muted">
			No longer available on Explore.
		</p>
		<p v-else-if="listing.summary" class="text-sm text-muted line-clamp-2">
			{{ listing.summary }}
		</p>
		<div v-if="listing.tags.length" class="relative flex flex-wrap gap-1">
			<UButton v-for="tag in listing.tags" :key="tag" :label="`#${tag}`" size="xs" color="neutral" variant="soft" @click="emit('tag', tag)" />
		</div>
		<div class="flex items-center gap-2 mt-auto text-xs text-dimmed min-w-0">
			<UBadge :label="LISTING_KINDS[listing.kind].label" color="neutral" variant="outline" size="sm" />
			<span class="truncate">{{ listing.publisher.name || listing.publisher.username }}</span>
			<span class="ms-auto flex items-center gap-1 shrink-0" :title="`Got by ${listing.gets}`">
				<UIcon name="i-lucide-download" class="size-3.5" />{{ listing.gets }}
			</span>
			<span class="shrink-0">{{ formatDistanceToNow(new Date(listing.publishedAt), { addSuffix: true }) }}</span>
		</div>
		<!-- Above the card's link. -->
		<div class="relative flex items-center gap-1">
			<StarButton :listing-id="listing.id" :starred="listing.starred" :stars="listing.stars" />
			<slot name="actions" />
		</div>
	</li>
</template>
