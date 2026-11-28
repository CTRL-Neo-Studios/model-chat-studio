import { Extension, mergeAttributes } from '@tiptap/core'
import Mention from '@tiptap/extension-mention'
import { Plugin } from '@tiptap/pm/state'

/**
 * Pasted plain text goes in as Markdown: headings, lists and bold come out formatted. Text copied from VS Code counts
 * as plain (its HTML is only colouring). Other HTML, files and pastes into a code block paste as usual.
 */
export const MarkdownPaste = Extension.create({
	name: 'markdownPaste',
	addProseMirrorPlugins() {
		const editor = this.editor
		return [new Plugin({
			props: {
				handlePaste: (_view, event) => {
					const data = event.clipboardData
					const text = data?.getData('text/plain')
					if (!data || !text || data.files.length || editor.isActive('codeBlock')) return false
					if (data.getData('text/html') && !data.types.includes('vscode-editor-data')) return false
					return editor.commands.insertContent(text, { contentType: 'markdown' })
				},
			},
		})]
	},
})

const mentionLabel = (attrs: Record<string, unknown>) => `${attrs.mentionSuggestionChar ?? '@'}${attrs.label ?? attrs.id}`

/** An "@" mention as `UEditor` makes it, written as `@label` in Markdown too (the built-in one is dropped there). */
export const MarkdownMention = Mention.extend({
	renderMarkdown: node => mentionLabel(node.attrs ?? {}),
}).configure({
	HTMLAttributes: { class: 'mention' },
	renderText: ({ node }) => mentionLabel(node.attrs),
	renderHTML: ({ options, node }) => ['span', mergeAttributes({ 'data-type': 'mention' }, options.HTMLAttributes), mentionLabel(node.attrs)],
})
