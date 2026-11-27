<script setup lang="ts">
import type { PackageSource } from '#shared/utils/package'
import type { ListingTextsDraft } from './ListingTextsForm.vue'

/** A listing's texts (`ListingTextsForm`): to publish `source` (with what it holds), or, without one, to edit a listing's. */
const props = defineProps<{ heading: string, texts: ListingTextsDraft, source?: PackageSource }>()
const emit = defineEmits<{ close: [texts?: ListingTextsDraft] }>()

const { user } = useUserSession()
const { data: settings } = useQuery(exploreSettingsQuery)
const draft = ref<ListingTextsDraft>(structuredClone(toRaw(props.texts)))
const ok = ref(!props.source)
// Publishing off: members may not publish; admins and moderators still may. Reviewed: it waits for approval.
const closed = computed(() => !!props.source && settings.value?.publishing === 'off' && getRoleLevel(user.value?.role) < getRoleLevel('moderator'))
const reviewed = computed(() => !!props.source && settings.value?.publishing === 'reviewed')
const valid = computed(() => draft.value.name.trim() && draft.value.tags.length <= 5 && ok.value && !closed.value)
</script>

<template>
	<UModal :title="heading" :ui="{ content: 'sm:max-w-xl', footer: 'justify-end' }" @update:open="emit('close')">
		<template #body>
			<div class="flex flex-col gap-4">
				<UAlert v-if="closed" color="warning" variant="subtle" icon="i-lucide-lock" title="Publishing is turned off" description="An admin or moderator has turned off publishing to Explore. You can still browse and get." />
				<UAlert v-else-if="reviewed" color="info" variant="subtle" icon="i-lucide-shield-check" title="Publications are reviewed" description="It shows on Explore once an admin or moderator approves it; until then only you see it, on &quot;Your listings&quot;." />
				<ListingTextsForm v-model="draft" autofocus />
				<ListingPreview v-if="source" v-model:ok="ok" :source="source" />
			</div>
		</template>
		<template #footer>
			<UButton color="neutral" variant="ghost" label="Cancel" @click="emit('close')" />
			<UButton :label="source ? 'Publish' : 'Save'" :icon="source ? 'i-lucide-telescope' : undefined" :disabled="!valid" @click="emit('close', { ...draft, name: draft.name.trim() })" />
		</template>
	</UModal>
</template>
