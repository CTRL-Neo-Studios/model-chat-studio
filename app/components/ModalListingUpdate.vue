<script setup lang="ts">
import type { PackageSource } from '#shared/utils/package'

/**
 * "Publish an update" (or "Publish again", `again`, after a rejection): a new version of a listing from the items it
 * was published from, with a note on what changed.
 */
defineProps<{ name: string, source: PackageSource, again?: boolean }>()
const emit = defineEmits<{ close: [notes?: string] }>()
const notes = ref('')
const ok = ref(false)
const { data: settings } = useQuery(exploreSettingsQuery)
</script>

<template>
	<UModal :title="again ? `Publish ${name} again` : `Publish an update of ${name}`" :ui="{ content: 'sm:max-w-xl', footer: 'justify-end' }" @update:open="emit('close')">
		<template #body>
			<div class="flex flex-col gap-4">
				<UAlert v-if="settings?.publishing === 'reviewed'" color="info" variant="subtle" icon="i-lucide-shield-check" title="Publications are reviewed" description="It waits for an admin or moderator to approve it; until then, what is on Explore stays as it is." />
				<UFormField :label="again ? 'What you changed' : 'What changed'" required :help="again ? 'For the reviewer, beside the earlier reason.' : 'Shown with the new version. Copies people already got stay as they are.'">
					<UTextarea v-model="notes" autoresize autofocus :rows="3" :maxrows="8" :maxlength="2000" class="w-full" />
				</UFormField>
				<ListingPreview v-model:ok="ok" :source="source" />
			</div>
		</template>
		<template #footer>
			<UButton color="neutral" variant="ghost" label="Cancel" @click="emit('close')" />
			<UButton :label="again ? 'Publish again' : 'Publish update'" icon="i-lucide-telescope" :disabled="!notes.trim() || !ok" @click="emit('close', notes.trim())" />
		</template>
	</UModal>
</template>
