import { speechPieces, speechText } from '#shared/utils/speech'

/** What is being read aloud: one answer at a time in the whole app. Only the browser changes it. */
const reading = shallowRef<{ id: string, controller: AbortController } | null>(null)
/** Waiting for a piece that should be playing. */
const waiting = ref(false)
/** Pieces fetched while the page is open, by platform, voice and text: listening again is free (plan section 1). */
const fetched = new Map<string, Promise<Blob>>()
/** One element plays every piece: started in the click, so Safari lets it play what arrives later. */
let element: HTMLAudioElement | undefined
/** A WAV of no samples, played in the click to unlock the element. */
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='

/** Plays one piece on the shared element; resolves when it ends or `signal` stops it. */
function playPiece(blob: Blob, signal: AbortSignal) {
	return new Promise<void>((resolve, reject) => {
		const audio = element!
		const url = URL.createObjectURL(blob)
		const finish = (error?: unknown) => {
			audio.onended = audio.onerror = null
			signal.removeEventListener('abort', onAbort)
			URL.revokeObjectURL(url)
			if (error) reject(error)
			else resolve()
		}
		const onAbort = () => {
			audio.pause()
			finish()
		}
		signal.addEventListener('abort', onAbort)
		audio.onended = () => finish()
		audio.onerror = () => finish(new Error('The audio could not be played'))
		audio.src = url
		audio.play().catch(finish)
	})
}

/**
 * Read-aloud (milestone 10 plan, section 1): an answer's text, plain, cut into pieces that are fetched one after
 * another (the next while one plays) and played in order. Stop cancels what is left. Whoever listens pays, so it is
 * offered only once the active platform has it set up.
 */
export function useReadAloud() {
	const { csrf, headerName } = useCsrf()
	const toast = useToast()
	const { data: speech } = useQuery(speechVoicesQuery)
	const available = computed(() => !!speech.value?.available)

	function stop() {
		reading.value?.controller.abort()
		reading.value = null
		waiting.value = false
	}

	/** Reads `parts` (an answer's) aloud as `id`; `voice` overrides the member's, for a sample. */
	async function read(id: string, parts: { type: string, text?: string }[], options: { voice?: string } = {}) {
		stop()
		const pieces = speechPieces(speechText(parts))
		if (!pieces.length || !speech.value?.available) return
		element ??= new Audio()
		element.src = SILENCE
		element.play().catch(() => {})

		const controller = new AbortController()
		const own = { id, controller }
		reading.value = own
		const voice = options.voice ?? speech.value.voice ?? speech.value.defaultVoice
		const piece = (text: string) => {
			const key = `${speech.value?.platform}:${voice}:${text}`
			let blob = fetched.get(key)
			if (!blob) {
				blob = $fetch<Blob>('/api/v1/speech', { method: 'POST', body: { text, voice }, headers: { [headerName]: csrf }, responseType: 'blob', signal: controller.signal })
				fetched.set(key, blob)
				blob.catch(() => fetched.delete(key))
			}
			return blob
		}
		try {
			let next = piece(pieces[0]!)
			for (let index = 0; index < pieces.length; index++) {
				waiting.value = true
				const blob = await next
				waiting.value = false
				if (controller.signal.aborted) return
				if (index + 1 < pieces.length) next = piece(pieces[index + 1]!)
				await playPiece(blob, controller.signal)
				if (controller.signal.aborted) return
			}
		}
		catch (error) {
			if (!controller.signal.aborted) toast.add({ title: 'This could not be read aloud', description: serverMessage(error), icon: 'i-lucide-alert-circle', color: 'error' })
		}
		finally {
			if (reading.value === own) {
				reading.value = null
				waiting.value = false
			}
		}
	}

	return {
		available,
		/** The id being read, or `null`. */
		readingId: computed(() => reading.value?.id ?? null),
		waiting: readonly(waiting),
		read,
		stop,
	}
}
