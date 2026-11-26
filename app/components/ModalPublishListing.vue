<script setup lang="ts">
import type { PackageSource } from '#shared/utils/package'

export interface ListingTextsDraft {
	name: string
	summary: string
	description: string
	tags: string[]
	category: string | null
}

/** A listing's texts: to publish `source` (with what it holds), or, without one, to edit a listing's. */
const props = defineProps<{ heading: string, texts: ListingTextsDraft, source?: PackageSource }>()
const emit = defineEmits<{ close: [texts?: ListingTextsDraft] }>()

const { user } = useUserSession()
const { data: settings } = useQuery(exploreSettingsQuery)
const draft = ref<ListingTextsDraft>(structuredClone(toRaw(props.texts)))
const ok = ref(!props.source)
// Publishing off: members may not publish; admins and moderators still may. Reviewed: it waits for approval.
const closed = computed(() => !!props.source && settings.value?.publishing === 'off' && getRoleLevel(user.value?.role) < getRoleLevel('moderator'))
const reviewed = computed(() => !!props.source && settings.value?.publishing === 'reviewed')
const NONE = 'none'
const categories = computed(() => [{ label: 'None', value: NONE }, ...(settings.value?.categories ?? []).map(name => ({ label: name, value: name }))])
const valid = computed(() => draft.value.name.trim() && draft.value.tags.length <= 5 && ok.value && !closed.value)
</script>

<template>
	<UModal :title="heading" :ui="{ content: 'sm:max-w-xl', footer: 'justify-end' }" @update:open="emit('close')">
		<template #body>
			<div class="flex flex-col gap-4">
				<UAlert v-if="closed" color="warning" variant="subtle" icon="i-lucide-lock" title="Publishing is turned off" description="An admin or moderator has turned off publishing to Explore. You can still browse and get." />
				<UAlert v-else-if="reviewed" color="info" variant="subtle" icon="i-lucide-shield-check" title="Publications are reviewed" description="It shows on Explore once an admin or moderator approves it; until then only you see it, on &quot;Your listings&quot;." />
				<UFormField label="Name" required>
					<UInput v-model="draft.name" :maxlength="80" autofocus class="w-full" />
				</UFormField>
				<UFormField label="Summary" help="One line, shown on its card.">
					<UInput v-model="draft.summary" :maxlength="200" class="w-full" />
				</UFormField>
				<UFormField label="Description" help="Markdown: what it is, how to use it.">
					<UTextarea v-model="draft.description" autoresize :rows="4" :maxrows="12" :maxlength="20000" class="w-full" />
				</UFormField>
				<div class="grid gap-4 sm:grid-cols-2">
					<UFormField v-if="settings?.categories.length" label="Category">
						<USelect :model-value="draft.category ?? NONE" :items="categories" class="w-full" @update:model-value="value => draft.category = value === NONE ? null : value" />
					</UFormField>
					<UFormField label="Tags" help="Up to 5.">
						<UInputTags v-model="draft.tags" placeholder="Add a tag" :max="5" :max-length="30" add-on-blur class="w-full" />
					</UFormField>
				</div>
				<ListingPreview v-if="source" v-model:ok="ok" :source="source" />
			</div>
		</template>
		<template #footer>
			<UButton color="neutral" variant="ghost" label="Cancel" @click="emit('close')" />
			<UButton :label="source ? 'Publish' : 'Save'" :icon="source ? 'i-lucide-telescope' : undefined" :disabled="!valid" @click="emit('close', { ...draft, name: draft.name.trim() })" />
		</template>
	</UModal>
</template>
