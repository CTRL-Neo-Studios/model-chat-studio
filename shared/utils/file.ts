/** What can be attached to a message. Text files are decoded on the server and sent as text. */
export const FILE_UPLOAD = {
	maxSize: '8MB',
	/** SVG is left out on purpose: it can carry script, and no platform reads it as an image. */
	imageTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
	pdfType: 'application/pdf',
	textTypes: ['text/plain', 'text/csv', 'text/markdown'],
} as const

export const FILE_UPLOAD_TYPES: string[] = [...FILE_UPLOAD.imageTypes, FILE_UPLOAD.pdfType, ...FILE_UPLOAD.textTypes]

/** The `accept` attribute for the types a model can take: text always, images and PDFs when it reads them. */
export function fileAcceptPattern(options: { images: boolean, pdf: boolean }): string {
	return [
		...(options.images ? FILE_UPLOAD.imageTypes : []),
		...(options.pdf ? [FILE_UPLOAD.pdfType] : []),
		...FILE_UPLOAD.textTypes,
		'.csv',
		'.md',
		'.txt',
	].join(',')
}

export function getFileIcon(mediaType: string): string {
	if (mediaType.startsWith('image/')) return 'i-lucide-image'
	if (mediaType === 'application/pdf') return 'i-lucide-file-text'
	if (mediaType === 'text/csv') return 'i-lucide-file-spreadsheet'
	return 'i-lucide-file'
}

/** `/api/v1/files/<uuid>`: the only file URL a message may carry. */
export const FILE_URL_PATTERN = /^\/api\/v1\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/
