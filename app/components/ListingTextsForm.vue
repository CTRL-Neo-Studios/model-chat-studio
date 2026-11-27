<script setup lang="ts">
/** A listing's texts as its publisher writes them: in the publish dialog, and in a package's studio. */
export interface ListingTextsDraft {
	name: string
	summary: string
	description: string
	tags: string[]
	category: string | null
}

const draft = defineModel<ListingTextsDraft>({ required: true })
defineProps<{ autofocus?: boolean }>()

const { data: settings } = useQuery(exploreSettingsQuery)
const NONE = 'none'
const categories = computed(() => [{ label: 'None', value: NONE }, ...(settings.value?.categories ?? []).map(name => ({ label: name, value: name }))])
</script>

<template>
	<div class="flex flex-col gap-4">
		<UFormField label="Name" required>
			<UInput v-model="draft.name" :maxlength="80" :autofocus="autofocus" class="w-full" />
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
	</div>
</template>
