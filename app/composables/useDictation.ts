import { experimental_resampleAudio as resampleAudio } from 'ai'

/** Both speech-to-text APIs take 16 kHz; 120 s of it is 3.84 MB, under DeepSeek's 8 MiB. */
const SAMPLE_RATE = 16_000
/** Recordings stop on their own after this long (DeepSeek's limit). */
const MAX_DURATION = 120_000

/** 16-bit PCM mono WAV from samples in [-1, 1]. */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
	const bytes = new Uint8Array(44 + samples.length * 2)
	const view = new DataView(bytes.buffer)
	const ascii = (at: number, text: string) => [...text].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)))
	ascii(0, 'RIFF')
	view.setUint32(4, 36 + samples.length * 2, true)
	ascii(8, 'WAVE')
	ascii(12, 'fmt ')
	view.setUint32(16, 16, true)
	view.setUint16(20, 1, true) // PCM
	view.setUint16(22, 1, true) // mono
	view.setUint32(24, sampleRate, true)
	view.setUint32(28, sampleRate * 2, true)
	view.setUint16(32, 2, true)
	view.setUint16(34, 16, true)
	ascii(36, 'data')
	view.setUint32(40, samples.length * 2, true)
	samples.forEach((sample, i) => {
		const clamped = Math.max(-1, Math.min(1, sample))
		view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF, true)
	})
	return new Blob([bytes], { type: 'audio/wav' })
}

interface Session {
	stream: MediaStream
	audioContext: AudioContext
	source: MediaStreamAudioSourceNode
	processor: ScriptProcessorNode
	chunks: Float32Array[]
	timeout: ReturnType<typeof setTimeout>
}

/**
 * Records the microphone, then sends the clip as a WAV to `POST /transcriptions` when stopped.
 * The context runs at the device's rate (some browsers refuse another rate for a microphone);
 * samples are resampled to 16 kHz as they arrive.
 */
export function useDictation() {
	const { csrf, headerName } = useCsrf()

	// Assumed on the server so the button renders in the SSR output, checked once mounted.
	const supported = ref(true)
	const recording = ref(false)
	/** Waiting for the transcript after the recording stopped. */
	const transcribing = ref(false)
	/** Normalized input volume between 0 and 1 while recording. */
	const level = ref(0)

	let session: Session | null = null
	let starting = false
	let cancelled = false

	onMounted(() => {
		supported.value = typeof AudioContext !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
	})

	function release(current: Session) {
		clearTimeout(current.timeout)
		current.processor.onaudioprocess = null
		current.processor.disconnect()
		current.source.disconnect()
		current.audioContext.close().catch(() => {})
		current.stream.getTracks().forEach(track => track.stop())
		recording.value = false
		level.value = 0
	}

	/** Opens the microphone. `onMaxDuration` runs when the time limit is hit, as if the user stopped. */
	async function start(options: { onMaxDuration?: () => void } = {}) {
		if (session || starting) return
		starting = true
		cancelled = false
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch((cause: Error) => {
				throw cause.name === 'NotAllowedError' ? new Error('Microphone access was denied') : cause
			})
			if (cancelled) {
				stream.getTracks().forEach(track => track.stop())
				return
			}

			const audioContext = new AudioContext()
			const source = audioContext.createMediaStreamSource(stream)
			const processor = audioContext.createScriptProcessor(4096, 1, 1)
			const chunks: Float32Array[] = []
			processor.onaudioprocess = (event) => {
				const input = event.inputBuffer.getChannelData(0)
				let sum = 0
				for (const sample of input) sum += sample * sample
				level.value = Math.min(1, Math.sqrt(sum / input.length) * 5)
				chunks.push(resampleAudio(new Float32Array(input), audioContext.sampleRate, SAMPLE_RATE))
			}
			// The processor only runs while connected; muted so the microphone is not played back.
			const silence = audioContext.createGain()
			silence.gain.value = 0
			source.connect(processor)
			processor.connect(silence)
			silence.connect(audioContext.destination)

			session = { stream, audioContext, source, processor, chunks, timeout: setTimeout(() => options.onMaxDuration?.(), MAX_DURATION) }
			recording.value = true
		}
		finally {
			starting = false
		}
	}

	/** Stops recording and resolves with the transcript. */
	async function stop(): Promise<string> {
		const current = session
		if (!current) return ''
		session = null
		release(current)

		const samples = new Float32Array(current.chunks.reduce((total, chunk) => total + chunk.length, 0))
		let offset = 0
		for (const chunk of current.chunks) {
			samples.set(chunk, offset)
			offset += chunk.length
		}
		if (!samples.length) return ''

		const form = new FormData()
		form.append('file', encodeWav(samples, SAMPLE_RATE), 'speech.wav')
		transcribing.value = true
		try {
			const { text } = await $fetch<{ text: string }>('/api/v1/transcriptions', { method: 'POST', headers: { [headerName]: csrf }, body: form })
			return cancelled ? '' : text
		}
		finally {
			transcribing.value = false
		}
	}

	/** Stops recording and discards it. */
	function cancel() {
		cancelled = true
		const current = session
		if (!current) return
		session = null
		release(current)
	}

	onScopeDispose(cancel)

	return { supported, recording, transcribing, level, start, stop, cancel }
}
