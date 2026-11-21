/**
 * The duration of a 16-bit PCM WAV clip in seconds, read from its header, or `null` when the bytes
 * are not one. Both speech-to-text APIs take this format; DeepSeek caps a clip at 120 s.
 */
export function wavDurationSeconds(bytes: Uint8Array): number | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))
	if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null

	let byteRate = 0
	// Chunks follow the 12-byte header: a 4-byte id, a 4-byte little-endian size, then the body (padded to even).
	for (let at = 12; at + 8 <= bytes.length; at += 8 + view.getUint32(at + 4, true) + (view.getUint32(at + 4, true) % 2)) {
		const id = tag(at)
		if (id === 'fmt ') {
			const pcm = view.getUint16(at + 8, true) === 1 && view.getUint16(at + 22, true) === 16
			if (!pcm) return null
			byteRate = view.getUint32(at + 16, true)
		}
		else if (id === 'data') {
			return byteRate ? view.getUint32(at + 4, true) / byteRate : null
		}
	}
	return null
}
