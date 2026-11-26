<script setup lang="ts">
import { formatDistanceToNow } from 'date-fns'

definePageMeta({ minRole: 'moderator' })
useHead({ title: 'Review' })

const { user } = useUserSession()
const { data, isPending } = useQuery(exploreReviewsQuery)
const pending = computed(() => data.value?.pending ?? [])
</script>

<template>
	<AdminPanel title="Review">
		<p class="text-sm text-muted">
			Publications waiting for review, oldest first. Each opens on the page members will see, with everything inside, to approve or reject it. Nobody reviews their own.
		</p>
		<div v-if="isPending" class="flex flex-col gap-2" aria-busy="true" aria-label="Loading the review queue">
			<USkeleton v-for="n in 3" :key="n" class="h-16 w-full" />
		</div>
		<UEmpty v-else-if="!pending.length" icon="i-lucide-shield-check" title="Nothing waits for review" description="In reviewed mode, new listings and updates show here until an admin or moderator approves or rejects them." />
		<ul v-else class="flex flex-col divide-y divide-default rounded-md border border-default">
			<li v-for="entry in pending" :key="entry.versionId" class="relative flex flex-col gap-1 px-4 py-3 hover:bg-elevated/50 has-focus-visible:ring-2 has-focus-visible:ring-primary">
				<div class="flex items-center gap-3 min-w-0">
					<UIcon :name="LISTING_KINDS[entry.kind].icon" class="size-5 text-muted shrink-0" />
					<!-- The link covers the row. -->
					<NuxtLink :to="{ path: `/explore/${entry.listingId}`, query: { version: entry.versionId } }" class="font-medium text-highlighted truncate flex-1 outline-none after:absolute after:inset-0">
						{{ entry.name }}
					</NuxtLink>
					<UBadge :label="entry.update ? `Update, version ${entry.number}` : 'New listing'" :color="entry.update ? 'neutral' : 'info'" variant="subtle" size="sm" />
					<UBadge v-if="entry.ownerId === user?.id" label="Yours: another reviews it" color="warning" variant="subtle" size="sm" />
				</div>
				<p class="text-xs text-muted">
					{{ LISTING_KINDS[entry.kind].label }} by {{ entry.publisher.name || entry.publisher.username }} · sent {{ formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true }) }}
				</p>
				<p v-if="entry.notes" class="text-sm text-muted whitespace-pre-wrap">
					{{ entry.notes }}
				</p>
				<p v-if="entry.rejectedBefore" class="text-xs text-error">
					Rejected before: {{ entry.rejectedBefore }}
				</p>
			</li>
		</ul>
	</AdminPanel>
</template>
