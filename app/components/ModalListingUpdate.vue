<script setup lang="ts">
import type { PackageSource } from '#shared/utils/package'

/** "Publish an update": a new version of a listing from the items it was published from, with a note on what changed. */
defineProps<{ name: string, source: PackageSource }>()
const emit = defineEmits<{ close: [notes?: string] }>()
const notes = ref('')
const ok = ref(false)
</script>

<template>
	<UModal :title="`Publish an update of ${name}`" :ui="{ content: 'sm:max-w-xl', footer: 'justify-end' }" @update:open="emit('close')">
		<template #body>
			<div class="flex flex-col gap-4">
				<UFormField label="What changed" required help="Shown with the new version. Copies people already got stay as they are.">
					<UTextarea v-model="notes" autoresize autofocus :rows="3" :maxrows="8" :maxlength="2000" class="w-full" />
				</UFormField>
				<ListingPreview v-model:ok="ok" :source="source" />
			</div>
		</template>
		<template #footer>
			<UButton color="neutral" variant="ghost" label="Cancel" @click="emit('close')" />
			<UButton label="Publish update" icon="i-lucide-telescope" :disabled="!notes.trim() || !ok" @click="emit('close', notes.trim())" />
		</template>
	</UModal>
</template>
