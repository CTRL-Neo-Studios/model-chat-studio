<script setup lang="ts">
import type { ChatStatus } from 'ai'
import type { ChatSettings } from '#shared/utils/chat'
import type { LaneDraft } from '~/composables/useChatSettings'
import type { PromptUpload } from '~/composables/usePromptUploads'

const props = withDefaults(defineProps<{
	status?: ChatStatus
	error?: Error
	disabled?: boolean
	/** The upload state of the files, in the same order as `v-model:files`. */
	uploads?: PromptUpload[]
	uploading?: boolean
}>(), {
	status: 'ready',
	error: undefined,
	uploads: () => [],
})

const emit = defineEmits<{
	submit: [event: Event]
	stop: []
	reload: []
}>()

const input = defineModel<string>({ default: '' })
const files = defineModel<File[]>('files', { default: () => [] })
const lane = defineModel<LaneDraft>('lane', { required: true })
const settings = defineModel<ChatSettings>('settings', { required: true })

const { platform, resolveModel } = useModels()
const model = computed(() => resolveModel(lane.value.modelId ?? undefined))
// Text files always; images and PDFs when the model reads them.
const accept = computed(() => fileAcceptPattern({
	images: !!model.value?.inputModalities.includes('image'),
	pdf: !!model.value?.inputModalities.includes('file'),
}))

// Provider choices belong to one model.
function setModel(id: string) {
	lane.value = { ...lane.value, modelId: id, params: { ...lane.value.params, providers: undefined } }
}

// A model no longer offered falls back to the default without its provider and reasoning choices,
// as on the server; clearing them keeps the pickers from showing choices that are ignored.
watch(model, (current) => {
	if (current && lane.value.modelId && lane.value.modelId !== current.id) {
		lane.value = { ...lane.value, modelId: current.id, params: { ...lane.value.params, providers: undefined, reasoningLevel: undefined } }
	}
}, { immediate: true })

const dictation = ref<'idle' | 'recording' | 'transcribing'>('idle')
const placeholder = computed(() => ({ idle: undefined, recording: 'Listening...', transcribing: 'Transcribing...' })[dictation.value])
// The microphone replaces the send button while the prompt is empty.
const canDictate = computed(() => dictation.value !== 'idle' || (props.status === 'ready' && !input.value.trim() && !files.value.length))

function appendTranscript(text: string) {
	input.value = input.value.trim() ? `${input.value.trimEnd()} ${text}` : text
}
</script>

<template>
	<UChatPrompt
		v-model="input"
		v-model:files="files"
		:accept="accept"
		:status="status"
		:error="error"
		:disabled="disabled"
		:placeholder="placeholder"
		color="neutral"
		variant="subtle"
		:ui="{ base: ['px-1.5', dictation !== 'idle' && 'placeholder:italic'] }"
		@submit="emit('submit', $event)"
	>
		<template #files="{ remove }">
			<UChatAttachment
				v-for="(upload, index) in uploads"
				:key="upload.id"
				:file="upload.file"
				:icon="getFileIcon(upload.file.type)"
				:status="upload.status === 'uploaded' ? 'idle' : upload.status"
				:description="upload.error"
				size="sm"
				removable
				@remove="remove(index)"
			/>
		</template>

		<template #footer="{ open }">
			<ChatPromptMenu
				v-model:web-search="settings.webSearch"
				v-model:reasoning-level="lane.params.reasoningLevel"
				:model="model"
				:open="open"
			/>

			<div class="flex items-center gap-1 min-w-0">
				<ModelSelect :model-value="model?.id" @update:model-value="setModel($event!)" />

				<ChatProviderSelect
					v-if="model && platform?.capabilities.providerRouting"
					v-model:providers="lane.params.providers"
					v-model:allow-fallbacks="lane.params.allowFallbacks"
					:model-id="model.id"
				/>

				<ChatSettingsPanel
					v-model:params="lane.params"
					v-model:system-prompt="lane.systemPrompt"
					:web-search="settings.webSearch"
					:model="model"
				/>

				<ChatDictateButton
					v-if="canDictate"
					v-model:state="dictation"
					:disabled="uploading || disabled"
					@transcript="appendTranscript"
				/>
				<UChatPromptSubmit
					v-else
					:status="status"
					:disabled="uploading || disabled"
					color="neutral"
					size="sm"
					@stop="emit('stop')"
					@reload="emit('reload')"
				/>
			</div>
		</template>
	</UChatPrompt>
</template>
