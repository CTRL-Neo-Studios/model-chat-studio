<script setup lang="ts">
import type { ChatStatus } from 'ai'
import type { ChatParams } from '#shared/utils/chat'

// ponytail: attachments and dictation arrive in phase 7.
withDefaults(defineProps<{
	status?: ChatStatus
	error?: Error
	disabled?: boolean
}>(), {
	status: 'ready',
	error: undefined,
})

const emit = defineEmits<{
	submit: [event: Event]
	stop: []
	reload: []
}>()

const input = defineModel<string>({ default: '' })
const params = defineModel<ChatParams>('params', { required: true })
const systemPrompt = defineModel<string>('systemPrompt', { required: true })

const { platform, resolveModel } = useModels()
const model = computed(() => resolveModel(params.value.model))

// Provider choices belong to one model.
function setModel(id: string) {
	params.value = { ...params.value, model: id, providers: undefined }
}
</script>

<template>
	<UChatPrompt
		v-model="input"
		:status="status"
		:error="error"
		:disabled="disabled"
		color="neutral"
		variant="subtle"
		:ui="{ base: 'px-1.5' }"
		@submit="emit('submit', $event)"
	>
		<template #footer>
			<ChatPromptMenu
				v-model:web-search="params.webSearch"
				v-model:reasoning-level="params.reasoningLevel"
				:model="model"
			/>

			<div class="flex items-center gap-1 min-w-0">
				<ModelSelect :model-value="model?.id" @update:model-value="setModel($event!)" />

				<ChatProviderSelect
					v-if="model && platform?.capabilities.providerRouting"
					v-model:providers="params.providers"
					v-model:allow-fallbacks="params.allowFallbacks"
					:model-id="model.id"
				/>

				<ChatSettingsPanel v-model:params="params" v-model:system-prompt="systemPrompt" :model="model" />

				<UChatPromptSubmit
					:status="status"
					:disabled="disabled"
					color="neutral"
					size="sm"
					@stop="emit('stop')"
					@reload="emit('reload')"
				/>
			</div>
		</template>
	</UChatPrompt>
</template>
