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
	/** Messages in the longest lane thread: the memory slider's range. Unset hides the slider (a new chat). */
	memoryMax?: number
}>(), {
	status: 'ready',
	error: undefined,
	uploads: () => [],
	memoryMax: undefined,
})

const emit = defineEmits<{
	submit: [event: Event]
	stop: []
	reload: []
}>()

const input = defineModel<string>({ default: '' })
const files = defineModel<File[]>('files', { default: () => [] })
const webSearch = defineModel<boolean | undefined>('webSearch')
/** How many messages each lane is sent; `null` is all. */
const memoryLength = defineModel<number | null | undefined>('memoryLength')

// The slider's rightmost step means "all", so the chat can grow past it. It shows its value while dragged and is
// saved when released, not on every step.
const memoryAll = computed(() => (props.memoryMax ?? 1) + 1)
const memoryStep = ref(memoryLength.value ?? memoryAll.value)
watch([memoryLength, memoryAll], () => memoryStep.value = memoryLength.value ?? memoryAll.value)
function commitMemory() {
	memoryLength.value = memoryStep.value >= memoryAll.value ? null : memoryStep.value
}
const memoryLabel = computed(() => memoryLength.value ? `Memory: ${memoryLength.value} ${memoryLength.value === 1 ? 'message' : 'messages'}` : 'Memory: all')

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
			<div class="flex items-center gap-1 min-w-0">
				<ChatPromptMenu
					v-model:web-search="webSearch"
					:web-search-available="models.some(model => model.webSearch)"
					:open="open"
				/>
				<UPopover v-if="memoryMax !== undefined" :content="{ side: 'top', align: 'start' }">
					<UButton :label="memoryLabel" icon="i-lucide-brain" color="neutral" variant="ghost" size="sm" :class="memoryLength && 'text-highlighted'" />
					<template #content>
						<div class="w-72 p-3 flex flex-col gap-3">
							<p class="text-sm text-muted">
								How many recent messages each model is sent with your next message. Fewer is cheaper; the model forgets the rest.
							</p>
							<USlider v-model="memoryStep" :min="1" :max="memoryAll" aria-label="Messages sent" @change="commitMemory" />
							<div class="flex justify-between text-xs text-muted">
								<span>1</span>
								<span class="text-highlighted font-medium">{{ memoryStep >= memoryAll ? 'All' : memoryStep }}</span>
								<span>All</span>
							</div>
						</div>
					</template>
				</UPopover>
			</div>

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
