import { deriveSecret } from 'nuxt/server'

// Bump both together to rotate: old values keep their version byte and stay readable by a branch on it.
const VERSION = 1
const PURPOSE = 'model-chat-studio:api-keys:v1'

/** Encrypts an API key for storage, with a key derived from `NUXT_APP_SECRET`. */
export async function sealSecret(plaintext: string): Promise<string> {
	return encryptSecret(plaintext, await deriveSecret(PURPOSE))
}

/** Throws when the value was sealed under another app secret. */
export async function openSecret(sealed: string): Promise<string> {
	return decryptSecret(sealed, await deriveSecret(PURPOSE))
}

async function importKey(keyHex: string) {
	const raw = Uint8Array.from(keyHex.match(/../g)!, byte => Number.parseInt(byte, 16))
	return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

/** AES-256-GCM. Output: base64 of `version byte ‖ 12-byte IV ‖ ciphertext`. */
export async function encryptSecret(plaintext: string, keyHex: string): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12))
	const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await importKey(keyHex), new TextEncoder().encode(plaintext)))
	return Buffer.concat([Uint8Array.of(VERSION), iv, ciphertext]).toString('base64')
}

export async function decryptSecret(sealed: string, keyHex: string): Promise<string> {
	const bytes = Buffer.from(sealed, 'base64')
	if (bytes[0] !== VERSION) throw new Error(`Unknown secret version ${bytes[0]}`)
	const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(1, 13) }, await importKey(keyHex), bytes.subarray(13))
	return new TextDecoder().decode(plaintext)
}
