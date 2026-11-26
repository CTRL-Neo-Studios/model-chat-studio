<script setup lang="ts">
import { formatDistanceToNow } from 'date-fns'
import { LazyModalRename } from '#components'

definePageMeta({ minRole: 'moderator' })
useHead({ title: 'Review' })

const { user } = useUserSession()
const { data, isPending } = useQuery(exploreReviewsQuery)
const pending = computed(() => data.value?.pending ?? [])
const reports = computed(() => data.value?.reports ?? [])

const act = useApiAction()
const queryCache = useQueryCache()
const reasonModal = useOverlay().create(LazyModalRename)
const deciding = ref<string>()
// Dismiss, or remove the listing with the reason its publisher reads (the report's own, to start from).
async function decide(reportId: string, remove: boolean, reported?: string) {
	const reason = remove ? await reasonModal.open({ title: reported, heading: 'Remove this listing', description: 'It leaves Explore; its publisher reads the reason. Every open report of it is settled.', placeholder: 'Why it was removed', maxlength: 500 }).result : undefined
	if (remove && !reason) return
	deciding.value = reportId
	const done = await act(`/api/v1/explore/reports/${reportId}`, { method: 'PATCH', body: remove ? { remove: true, reason } : { dismiss: true }, success: remove ? 'Removed: its publisher sees why' : 'Report dismissed' })
	deciding.value = undefined
	if (done) await Promise.all([queryCache.invalidateQueries({ key: ['explore'] }), queryCache.invalidateQueries({ key: adminListingsQuery.key })])
}
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

		<h2 class="font-medium text-highlighted">
			Reports
		</h2>
		<p class="text-sm text-muted -mt-4">
			What members reported, oldest first. Removing a listing settles every open report of it; its publisher reads the reason, not who reported it.
		</p>
		<UEmpty v-if="!isPending && !reports.length" icon="i-lucide-flag" title="No open reports" description="A member's report of a listing shows here until it is dismissed or the listing removed." />
		<ul v-else-if="reports.length" class="flex flex-col divide-y divide-default rounded-md border border-default">
			<li v-for="entry in reports" :key="entry.id" class="flex flex-wrap items-start gap-3 px-4 py-3">
				<UIcon :name="LISTING_KINDS[entry.kind].icon" class="size-5 text-muted shrink-0 mt-0.5" />
				<div class="flex-1 min-w-0 flex flex-col gap-1">
					<div class="flex items-center gap-2 min-w-0">
						<ULink :to="`/explore/${entry.listingId}`" class="font-medium text-highlighted truncate">
							{{ entry.name }}
						</ULink>
						<UBadge v-if="entry.status !== 'listed'" :label="entry.status === 'removed' ? 'Removed' : 'Unlisted'" color="warning" variant="subtle" size="sm" />
					</div>
					<p class="text-xs text-muted">
						{{ LISTING_KINDS[entry.kind].label }} by {{ entry.publisher }} · reported by {{ entry.reporter.name || entry.reporter.username }} {{ formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true }) }}
					</p>
					<p class="text-sm whitespace-pre-wrap">
						{{ entry.reason }}
					</p>
				</div>
				<div class="flex items-center gap-1">
					<UButton label="Dismiss" size="sm" color="neutral" variant="ghost" :loading="deciding === entry.id" @click="decide(entry.id, false)" />
					<UButton v-if="entry.status !== 'removed'" label="Remove…" icon="i-lucide-ban" size="sm" color="error" variant="soft" :loading="deciding === entry.id" @click="decide(entry.id, true, entry.reason)" />
				</div>
			</li>
		</ul>
	</AdminPanel>
</template>
