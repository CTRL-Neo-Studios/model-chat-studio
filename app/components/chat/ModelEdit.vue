<script setup lang="ts">
import type { LaneFields } from '#shared/utils/chat'
import type { Lane } from '~/composables/useChatLanes'

const props = defineProps<{
	lane: Lane
	/** The lane belongs to a saved chat, so it can be written back to its profile. */
	saved: boolean
}>()

/** What to do with the lane; nothing when cancelled. */
const emit = defineEmits<{ close: [result?: { action: 'save' | 'apply', fields: LaneFields } | { action: 'remove' }] }>()

const toast = useToast()
const queryCache = useQueryCache()
const { models, resolveModel } = useModels()

const { id: _, profileId: __, position: ___, platform: ____, ...fields } = structuredClone(toRaw(props.lane))
const draft = ref<LaneFields>(fields)
const placeholder = computed(() => resolveModel(draft.value.modelId ?? undefined)?.name ?? 'Default model')

function result(action: 'save' | 'apply') {
	return { action, fields: { ...draft.value, name: draft.value.name?.trim() || null } }
}

// Back to the profile's values; saving still decides.
async function reset() {
	const { data: profiles = [] } = await queryCache.refresh(queryCache.ensure(modelProfilesQuery))
	const profile = profiles.find(entry => entry.id === props.lane.profileId)
	if (!profile) {
		toast.add({ description: 'The profile no longer exists', icon: 'i-lucide-alert-circle', color: 'error' })
		return
	}
	const { name, color, modelId, systemPrompt, params, characterId } = profile
	draft.value = { ...draft.value, name, color, modelId, systemPrompt, params: { ...params }, characterId }
}
</script>

<template>
	<UModal title="Model settings" description="Changes apply to this chat only." :ui="{ footer: 'justify-between' }" @update:open="emit('close')">
		<template #body>
			<div class="flex flex-col gap-5">
				<USwitch v-model="draft.enabled" label="Answers in this chat" description="When off, it skips new messages but keeps its answers." />
				<ModelProfileForm v-model="draft" :models="models" :name-placeholder="placeholder" />
			</div>
		</template>
		<template #footer>
			<div class="flex gap-1">
				<UButton label="Remove" color="error" variant="ghost" @click="emit('close', { action: 'remove' })" />
				<UButton v-if="lane.profileId" label="Reset" color="neutral" variant="ghost" @click="reset" />
			</div>
			<div class="flex gap-2">
				<UButton
					v-if="saved && lane.profileId"
					label="Apply to profile"
					color="neutral"
					variant="outline"
					:disabled="!draft.modelId"
					@click="emit('close', result('apply'))"
				/>
				<UButton label="Save" @click="emit('close', result('save'))" />
			</div>
		</template>
	</UModal>
</template>
