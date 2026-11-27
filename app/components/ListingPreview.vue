<script setup lang="ts">
import type { PackageSource } from '#shared/utils/package'

/**
 * What publishing `source` would hold and leave out, as the server would take it now. `ok`: it can be published.
 * `limitBytes`: the instance's size limit, shown beside the size.
 */
const props = defineProps<{ source: PackageSource, limitBytes?: number }>()
const ok = defineModel<boolean>('ok', { default: false })

const { csrf, headerName } = useCsrf()
const { data: preview, error, isPending } = useQuery({
	key: () => ['explore', 'preview', JSON.stringify(props.source)],
	query: () => $fetch('/api/v1/explore/preview', { method: 'POST', body: { source: props.source }, headers: { [headerName]: csrf } }),
	staleTime: 0,
})
watchEffect(() => ok.value = !!preview.value && !error.value)

const included = computed(() => preview.value
	? [
			...preview.value.characters.map(name => ({ icon: LISTING_KINDS.character.icon, label: name, detail: 'Character' })),
			...preview.value.libraries.map(library => ({ icon: LISTING_KINDS.library.icon, label: library.name, detail: `Library, ${library.entries} ${library.entries === 1 ? 'entry' : 'entries'}` })),
			...preview.value.structureProfiles.map(name => ({ icon: LISTING_KINDS.structureProfile.icon, label: name, detail: 'Structure profile' })),
			...(preview.value.setup ? [{ icon: 'i-lucide-folder-cog', label: 'The package\'s setup', detail: `${preview.value.setup.lanes} ${preview.value.setup.lanes === 1 ? 'model' : 'models'}, ${preview.value.setup.mode === 'group' ? 'a group' : 'separate answers'}` }] : []),
		]
	: [])
</script>

<template>
	<div class="flex flex-col gap-2">
		<p class="text-sm font-medium text-highlighted">
			What it holds
		</p>
		<USkeleton v-if="isPending" class="h-16 w-full" />
		<UAlert v-else-if="error" color="error" variant="subtle" icon="i-lucide-alert-circle" :title="serverMessage(error)" />
		<template v-else-if="preview">
			<ul class="flex flex-col gap-1.5 text-sm">
				<li v-for="item in included" :key="`${item.detail}:${item.label}`" class="flex items-center gap-2 min-w-0">
					<UIcon :name="item.icon" class="size-4 text-muted shrink-0" />
					<span class="text-highlighted truncate">{{ item.label }}</span>
					<span class="text-xs text-dimmed truncate">{{ item.detail }}</span>
				</li>
			</ul>
			<p class="text-xs text-dimmed">
				{{ preview.files }} {{ preview.files === 1 ? 'file' : 'files' }} · {{ fileSize(preview.size) }}{{ limitBytes ? ` of ${fileSize(limitBytes)}` : '' }} in all. Others get a copy as it is now; later changes need "Publish an update".
			</p>
			<UAlert v-if="preview.left.length" color="warning" variant="subtle" icon="i-lucide-circle-alert" title="Left out" :description="preview.left.join(' ')" />
		</template>
	</div>
</template>
