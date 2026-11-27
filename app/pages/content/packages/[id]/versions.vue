<script setup lang="ts">
import { formatDistanceToNow } from 'date-fns'

// A package's Versions: each its listing has, newest first, with its state, its note and a rejection's reason.
definePageMeta({ key: route => route.path })

const route = useRoute()
const packageId = route.params.id as string
const { found, error, listing } = usePackage(packageId)
useHead({ title: () => found.value ? `${found.value.name}: versions` : 'Package' })

const STATES = {
	approved: { label: 'Approved', color: 'success' },
	pending: { label: 'Waiting for review', color: 'info' },
	rejected: { label: 'Rejected', color: 'error' },
} as const
</script>

<template>
	<UDashboardPanel id="package-versions" class="min-h-0">
		<template #header>
			<PageNavbar :current="found?.name" />
		</template>

		<template #body>
			<UError v-if="error" :error="{ statusMessage: 'Package not found', statusCode: 404 }" class="min-h-full" />
			<div v-else-if="found" class="w-full max-w-3xl mx-auto flex flex-col gap-4">
				<UEmpty v-if="!listing" icon="i-lucide-history" title="Not published yet" description="Each time it is published or updated, a version is kept here, with its note." />
				<ul v-else class="flex flex-col divide-y divide-default rounded-md border border-default">
					<li v-for="version in listing.versions" :key="version.id" class="flex flex-col gap-1 px-4 py-3">
						<div class="flex items-center gap-2">
							<span class="font-medium text-highlighted">Version {{ version.number }}</span>
							<UBadge :label="STATES[version.status].label" :color="STATES[version.status].color" variant="subtle" size="sm" />
							<UBadge v-if="version.number === listing.version" label="On Explore" color="primary" variant="subtle" size="sm" />
							<span class="text-xs text-dimmed flex-1">{{ formatDistanceToNow(new Date(version.createdAt), { addSuffix: true }) }}</span>
							<UButton label="Open" size="xs" color="neutral" variant="ghost" trailing-icon="i-lucide-arrow-right" :to="{ path: `/content/explore/${listing.id}`, query: { version: version.id } }" />
						</div>
						<p v-if="version.notes" class="text-sm text-muted whitespace-pre-wrap">
							{{ version.notes }}
						</p>
						<p v-if="version.reason" class="text-sm" :class="version.status === 'rejected' ? 'text-error' : 'text-muted'">
							{{ version.status === 'rejected' ? `Rejected: ${version.reason}` : version.reason }}
						</p>
					</li>
				</ul>
			</div>
		</template>
	</UDashboardPanel>
</template>
