import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { db } from 'hub:db'
import { z } from 'zod'
import { blob } from '#server/utils/core/blob'
import { requireChat } from '#server/utils/chat/access'
import { chatMarkdown, exportChat } from '#server/utils/chat/export'

const querySchema = z.object({
	/** `json`: the chat file, every branch and version; `markdown`: the branch that shows, to read. */
	format: z.enum(['json', 'markdown']).default('json'),
	/** The chat file carries its attachments' bytes (it can then be large); otherwise their names only. */
	files: z.stringbool().default(false),
})

/** Owner only: the chat as a download (milestone 12 plan, section 3). */
export default defineEventHandler(async (event) => {
	const chat = await requireChat(event, 'manageChat')
	const { format, files } = await getValidatedQuery(event, querySchema)
	const readFile = format === 'json' && files
		? async (path: string) => {
				const stored = await blob.get(path)
				return stored ? new Uint8Array(await stored.arrayBuffer()) : null
			}
		: undefined
	const file = await exportChat(db, chat.id, readFile)

	const name = (chat.title ?? 'chat').replace(/[\\/:*?"<>|]/g, '-').slice(0, 100)
	const extension = format === 'json' ? 'json' : 'md'
	const disposition = `attachment; filename="${name.replace(/[^\x20-\x7E]/g, '_')}.${extension}"; filename*=UTF-8''${encodeURIComponent(name)}.${extension}`
	const body = format === 'json' ? JSON.stringify(file) : chatMarkdown(file)
	return new Response(body, { headers: { 'Content-Type': format === 'json' ? 'application/json' : 'text/markdown; charset=utf-8', 'Content-Disposition': disposition } })
})
