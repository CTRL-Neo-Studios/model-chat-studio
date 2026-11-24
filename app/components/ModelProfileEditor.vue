<script setup lang="ts">
import type { LaneFields } from '#shared/utils/chat'
import type { CatalogModelView } from '~/composables/useModels'

type Draft = Omit<LaneFields, 'enabled'>

const props = defineProps<{
	title: string
	profile: Draft
	models: CatalogModelView[]
}>()

/** The edited profile, or nothing when cancelled. */
const emit = defineEmits<{ close: [profile?: Draft] }>()

const draft = ref<Draft>(structuredClone(toRaw(props.profile)))
const valid = computed(() => !!draft.value.name?.trim() && !!draft.value.modelId)
</script>

<template>
	<UModal :title="title" :ui="{ footer: 'justify-end' }" @update:open="emit('close')">
		<template #body>
			<ModelProfileForm v-model="draft" :models="models" />
		</template>
		<template #footer>
			<UButton color="neutral" variant="ghost" label="Cancel" @click="emit('close')" />
			<UButton label="Save" :disabled="!valid" @click="emit('close', draft)" />
		</template>
	</UModal>
</template>
