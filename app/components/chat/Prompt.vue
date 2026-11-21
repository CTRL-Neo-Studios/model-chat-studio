<script setup lang="ts">
import type { ChatStatus } from 'ai'
import type { CatalogModelView } from '~/composables/useModels'
import type { PromptUpload } from '~/composables/usePromptUploads'

const props = withDefaults(defineProps<{
	/** The models that will answer; attachments and web search follow what they can take. */
	models: CatalogModelView[]
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
const webSearch = defineModel<boolean | undefined>('webSearch')

// Text files always; images and PDFs when a model reads them. A model that cannot gets a note instead.
const accept = computed(() => fileAcceptPattern({
	images: props.models.some(model => model.inputModalities.includes('image')),
	pdf: props.models.some(model => model.inputModalities.includes('file')),
}))

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
				v-model:web-search="webSearch"
				:web-search-available="models.some(model => model.webSearch)"
				:open="open"
			/>

			<div class="flex items-center gap-1 min-w-0">
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
