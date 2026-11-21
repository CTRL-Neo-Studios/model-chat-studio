import type { FileUIPart } from 'ai'

export interface PromptUpload {
	/** Local id; the server's id arrives with `part`. */
	id: string
	file: File
	status: 'uploading' | 'uploaded' | 'error'
	part?: FileUIPart
	fileId?: string
	error?: string
}

/** The message the server sent with an error response, if any. */
function serverMessage(error: unknown): string | undefined {
	const data = typeof error === 'object' && error !== null && 'data' in error ? error.data : undefined
	return typeof data === 'object' && data !== null && 'message' in data && typeof data.message === 'string' ? data.message : undefined
}

/**
 * Attachments in the prompt: each file uploads as soon as it is added, and one removed from the
 * prompt before sending is deleted on the server. Once sent, files belong to their message.
 */
// Not `useFileUpload`: Nuxt UI auto-imports a composable of that name.
export function usePromptUploads(chatId: string) {
	const uploads = ref<PromptUpload[]>([])
	const toast = useToast()
	const { csrf, headerName } = useCsrf()

	// Looked up again after the upload: a file can be removed from the prompt while it uploads.
	function update(id: string, patch: Partial<PromptUpload>) {
		const index = uploads.value.findIndex(upload => upload.id === id)
		if (index === -1) return false
		uploads.value[index] = { ...uploads.value[index]!, ...patch }
		return true
	}

	function deleteRemote(fileId: string) {
		$fetch(`/api/v1/files/${fileId}`, { method: 'DELETE', headers: { [headerName]: csrf } })
			.catch(error => console.error('Failed to delete an attachment', error))
	}

	async function upload(entry: PromptUpload) {
		const form = new FormData()
		form.append('file', entry.file)
		try {
			const result = await $fetch<{ id: string, url: string, mediaType: string, filename: string }>(`/api/v1/chats/${chatId}/files`, {
				method: 'PUT',
				headers: { [headerName]: csrf },
				body: form,
			})
			const part: FileUIPart = { type: 'file', mediaType: result.mediaType, url: result.url, filename: result.filename }
			if (!update(entry.id, { status: 'uploaded', part, fileId: result.id })) deleteRemote(result.id)
		}
		catch (error) {
			const message = serverMessage(error) ?? 'Upload failed'
			toast.add({ title: `Could not attach ${entry.file.name}`, description: message, icon: 'i-lucide-alert-circle', color: 'error' })
			update(entry.id, { status: 'error', error: message })
		}
	}

	function remove(id: string) {
		const entry = uploads.value.find(upload => upload.id === id)
		uploads.value = uploads.value.filter(upload => upload.id !== id)
		if (entry?.fileId) deleteRemote(entry.fileId)
	}

	/** The `File[]` behind `UChatPrompt` `v-model:files`: added files upload, removed ones are deleted. */
	const promptFiles = computed<File[]>({
		get: () => uploads.value.map(upload => upload.file),
		set: (next) => {
			for (const entry of uploads.value.filter(upload => !next.includes(upload.file))) remove(entry.id)
			const added = next.filter(file => !uploads.value.some(upload => upload.file === file))
				.map(file => ({ id: crypto.randomUUID(), file, status: 'uploading' as const }))
			uploads.value = [...uploads.value, ...added]
			added.forEach(upload)
		},
	})

	return {
		uploads,
		promptFiles,
		uploading: computed(() => uploads.value.some(upload => upload.status === 'uploading')),
		/** The file parts of a message, for the uploads that finished. */
		parts: computed(() => uploads.value.flatMap(upload => upload.part ? [upload.part] : [])),
		/** Empties the prompt after sending; the files now belong to the message. */
		clear: () => {
			uploads.value = []
		},
	}
}
