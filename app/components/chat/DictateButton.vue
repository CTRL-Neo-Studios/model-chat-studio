<script setup lang="ts">
defineProps<{
	disabled?: boolean
}>()

const emit = defineEmits<{
	transcript: [text: string]
}>()

/** Exposed so the prompt can reflect the dictation state, for example in its placeholder. */
const state = defineModel<'idle' | 'recording' | 'transcribing'>('state', { default: 'idle' })

const toast = useToast()
const { supported, recording, transcribing, level, start, stop, cancel } = useDictation()

// Rolling input levels rendered as a small waveform while recording.
const BARS = 14
const bars = ref<number[]>(Array.from({ length: BARS }, () => 0))
let sampler: ReturnType<typeof setInterval> | undefined

watch(recording, (value) => {
	clearInterval(sampler)
	if (value) {
		bars.value = Array.from({ length: BARS }, () => 0)
		sampler = setInterval(() => {
			bars.value = [...bars.value.slice(1), level.value]
		}, 80)
	}
})

watch([recording, transcribing], ([isRecording, isTranscribing]) => {
	state.value = isRecording ? 'recording' : isTranscribing ? 'transcribing' : 'idle'
})

function fail(cause: unknown) {
	const description = serverMessage(cause) ?? (cause instanceof Error ? cause.message : String(cause))
	toast.add({ title: 'Dictation failed', description, icon: 'i-lucide-alert-circle', color: 'error' })
}

async function record() {
	if (!supported.value) {
		toast.add({ description: 'Dictation is not supported in this browser', icon: 'i-lucide-info', color: 'neutral' })
		return
	}
	await start({ onMaxDuration: finish }).catch(fail)
}

async function finish() {
	try {
		const text = await stop()
		if (text) emit('transcript', text)
	}
	catch (cause) {
		fail(cause)
	}
}

onBeforeUnmount(() => {
	clearInterval(sampler)
	cancel()
	state.value = 'idle'
})
</script>

<template>
	<div class="flex items-center gap-1">
		<template v-if="recording || transcribing">
			<div v-if="recording" class="flex items-center gap-0.75 h-7 px-2" aria-hidden="true">
				<span
					v-for="(bar, index) in bars"
					:key="index"
					class="w-0.5 rounded-full bg-inverted/80 transition-[height] duration-75"
					:style="{ height: `${Math.max(2, Math.round(bar * 18))}px` }"
				/>
			</div>

			<UButton
				v-if="recording"
				icon="i-lucide-x"
				color="neutral"
				variant="subtle"
				size="sm"
				aria-label="Cancel dictation"
				@click="cancel()"
			/>
			<UButton
				icon="i-lucide-check"
				color="neutral"
				size="sm"
				:loading="transcribing"
				aria-label="Finish dictation"
				@click="finish"
			/>
		</template>

		<UTooltip v-else :text="supported ? 'Dictate' : 'Dictation is not supported in this browser'" :content="{ side: 'top' }">
			<UButton
				icon="i-lucide-mic"
				color="neutral"
				variant="ghost"
				size="sm"
				:disabled="disabled"
				aria-label="Dictate"
				@click="record"
			/>
		</UTooltip>
	</div>
</template>
