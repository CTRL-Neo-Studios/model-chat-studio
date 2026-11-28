<script setup lang="ts">
import type { ChatStatus } from 'ai'
import { type Editor, Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { LazyModalLongPaste } from '#components'
import type { EditorMentionMenuItem, EditorSuggestionMenuItem, EditorToolbarItem } from '@nuxt/ui'
import type { CatalogModelView } from '~/composables/useModels'
import type { PromptUpload } from '~/composables/usePromptUploads'

/** A "/" command the prompt offers; the parent runs it. */
export interface PromptCommand {
	kind: 'compact' | 'clear' | 'temp' | 'rename' | 'image'
	label: string
	description: string
	icon: string
}

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
	/** "/" commands; none hides the menu. */
	commands?: PromptCommand[]
	/** A library's files, notes and folders for "@"; none hides the menu. */
	mentions?: EditorMentionMenuItem[]
	/** The chat's switches in the "+" menu (web search, images); off for an editor, whose chat it is not. */
	switches?: boolean
}>(), {
	status: 'ready',
	error: undefined,
	uploads: () => [],
	memoryMax: undefined,
	commands: () => [],
	mentions: () => [],
	switches: true,
})

const emit = defineEmits<{
	submit: [event: Event]
	stop: []
	reload: []
	command: [kind: PromptCommand['kind']]
}>()

const input = defineModel<string>({ default: '' })
const files = defineModel<File[]>('files', { default: () => [] })
const webSearch = defineModel<boolean | undefined>('webSearch')
/** The chat's "Images" switch: the model may draw. */
const images = defineModel<boolean | undefined>('images')
/** How many messages each lane is sent; `null` is all. */
const memoryLength = defineModel<number | null | undefined>('memoryLength')
/** The ids of the library entries named with "@". */
const references = defineModel<string[]>('references', { default: () => [] })

// The slider's rightmost step means "all", so the chat can grow past it. It shows its value while dragged and is
// saved when released, not on every step.
const memoryAll = computed(() => (props.memoryMax ?? 1) + 1)
const memoryStep = ref(memoryLength.value ?? memoryAll.value)
watch([memoryLength, memoryAll], () => memoryStep.value = memoryLength.value ?? memoryAll.value)
// Saved on release, and on closing the popover for a change made with the keyboard.
function commitMemory() {
	const next = memoryStep.value >= memoryAll.value ? null : memoryStep.value
	if (next !== (memoryLength.value ?? null)) memoryLength.value = next
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

// The prompt is an editor, for the "/" and "@" menus, in one of two modes, remembered per browser. Rich: formatting,
// and what is sent is its Markdown (which escapes what is typed literally, spike B). Raw: what is sent is its plain
// text, exactly as typed. Text set from outside (cleared after sending, dictation, a suggested prompt) goes back in.
const mode = useCookie<'rich' | 'raw'>('prompt-mode', { default: () => 'rich', sameSite: 'lax' })
let editor: Editor | undefined
// Rich mode's Markdown ends with the editor's trailing empty paragraph: trimmed.
const textOf = (instance: Editor) => mode.value === 'rich' ? instance.getMarkdown().trimEnd() : instance.getText({ blockSeparator: '\n' })
/** The entries named with "@", in order, each once. */
function referencesOf(instance: Editor) {
	const ids: string[] = []
	instance.state.doc.descendants((node) => {
		if (node.type.name === 'mention' && typeof node.attrs.id === 'string' && !ids.includes(node.attrs.id)) ids.push(node.attrs.id)
	})
	return ids
}
const docOf = (text: string) => ({ type: 'doc', content: text.split('\n').map(line => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })) })
function setText(instance: Editor, text: string) {
	if (mode.value === 'rich') instance.commands.setContent(text, { contentType: 'markdown' })
	else instance.commands.setContent(docOf(text))
}
watch(input, (value) => {
	if (editor && value !== textOf(editor)) setText(editor, value)
})
// A phone keyboard has no Shift+Enter: there, Enter breaks the line and the send button sends. In a list or a code
// block Enter is the editor's (a new item, a new line); Mod+Enter sends from anywhere. In rich mode Shift+Enter starts
// a paragraph, so "- " or "# " on the next line formats it; in raw mode it breaks the line.
const touch = import.meta.client && window.matchMedia('(pointer: coarse)').matches
// Lists and code blocks exist in rich mode only (asking a schema without them reads as true).
const inBlock = () => mode.value === 'rich' && !!editor && (editor.isActive('listItem') || editor.isActive('codeBlock'))

const overlay = useOverlay()
const longPasteModal = overlay.create(LazyModalLongPaste)
const { data: me } = useQuery(meQuery)
let pastedFiles = 0
/** "Paste as text" goes in as the paste would have (Markdown in rich mode); "Attach as a file" adds a `.txt` file. */
async function askLongPaste(instance: Editor, text: string, html: string) {
	const choice = await longPasteModal.open({ text }).result
	if (choice === 'file') files.value = [...files.value, new File([text], `Pasted text ${++pastedFiles}.txt`, { type: 'text/plain' })]
	if (choice !== 'text') return instance.commands.focus()
	if (html) instance.view.pasteHTML(html)
	else if (mode.value === 'rich' && !instance.isActive('codeBlock')) instance.commands.insertContent(text, { contentType: 'markdown' })
	else instance.view.pasteText(text)
	instance.commands.focus()
}
let extension: Extension | undefined
function promptExtension(submit: () => void) {
	extension ??= Extension.create({
		name: 'chatPrompt',
		priority: 1000,
		addKeyboardShortcuts: () => ({
			'Enter': () => !touch && !inBlock() && (submit(), true),
			'Shift-Enter': () => mode.value === 'rich' && !!editor && !inBlock() && editor.commands.splitBlock(),
			'Mod-Enter': () => (submit(), true),
		}),
		// A paste past the member's limit (Settings › Chat) asks first; files and short text paste as usual.
		addProseMirrorPlugins: () => [new Plugin({
			props: {
				handlePaste: (_view, event) => {
					const data = event.clipboardData
					const text = data?.getData('text/plain') ?? ''
					const limit = me.value?.preferences.longPaste ?? 0
					if (!editor || !data || data.files.length || !limit || text.length <= limit) return false
					askLongPaste(editor, text, data.types.includes('vscode-editor-data') ? '' : data.getData('text/html'))
					return true
				},
			},
		})],
		onCreate: ({ editor: created }) => {
			editor = created
			if (input.value) setText(created, input.value)
		},
		onUpdate: ({ editor: updated }) => {
			input.value = textOf(updated)
			references.value = referencesOf(updated)
		},
	})
	return extension
}

// Formatting on a selection, in rich mode.
const bubbleItems: EditorToolbarItem[][] = [[
	{ kind: 'mark', mark: 'bold', icon: 'i-lucide-bold', tooltip: { text: 'Bold' } },
	{ kind: 'mark', mark: 'italic', icon: 'i-lucide-italic', tooltip: { text: 'Italic' } },
	{ kind: 'mark', mark: 'strike', icon: 'i-lucide-strikethrough', tooltip: { text: 'Strikethrough' } },
	{ kind: 'mark', mark: 'code', icon: 'i-lucide-code', tooltip: { text: 'Code' } },
], [
	{ kind: 'bulletList', icon: 'i-lucide-list', tooltip: { text: 'Bullet list' } },
	{ kind: 'orderedList', icon: 'i-lucide-list-ordered', tooltip: { text: 'Numbered list' } },
	{ kind: 'blockquote', icon: 'i-lucide-text-quote', tooltip: { text: 'Quote' } },
	{ kind: 'codeBlock', icon: 'i-lucide-square-code', tooltip: { text: 'Code block' } },
]]

// Each command is run by the parent; the menu removes the typed "/name" first.
const commandItems = computed<EditorSuggestionMenuItem[]>(() => props.commands.map(({ kind, label, description, icon }) => ({ kind, label, description, icon })))
const commandHandlers = computed(() => Object.fromEntries(props.commands.map(command => [command.kind, {
	canExecute: () => true,
	isActive: () => false,
	execute: (instance: Editor) => {
		emit('command', command.kind)
		return instance.chain()
	},
}])))

// The "/" and "@" menus hang off the page, not the editor: the editor scrolls, which cut them to a sliver. They open
// above the cursor, where the prompt leaves room, and below it when there is none.
const menuParent = () => document.body
const menuOptions = { strategy: 'fixed', placement: 'top-start', offset: 8, flip: true, shift: { padding: 8 } } as const

// The page's class goes to the prompt; the wrapper only positions it in full screen.
defineOptions({ inheritAttrs: false })

// Full screen: the prompt covers its panel below the navbar, measured so it follows a resize; sending ends it.
// `UChatPrompt` sends a `style` to its own textarea, which the editor replaces: the wrapper div carries it.
const expanded = ref(false)
const panel = computed(() => expanded.value ? editor?.view.dom.closest<HTMLElement>('[id*="-panel-"]') ?? null : null)
const bounds = useElementBounding(panel)
const expandedStyle = computed(() => panel.value
	? { position: 'fixed' as const, top: `calc(${bounds.top.value}px + var(--ui-header-height))`, left: `${bounds.left.value}px`, width: `${bounds.width.value}px`, height: `calc(${bounds.height.value}px - var(--ui-header-height))` }
	: undefined)
function toggleExpanded() {
	expanded.value = !expanded.value
	nextTick(() => editor?.commands.focus())
}
</script>

<template>
	<!-- Laid out as if absent, except in full screen, where it is the fixed, opaque box the prompt fills. -->
	<div :class="expanded ? 'z-30 flex flex-col bg-default' : 'contents'" :style="expandedStyle">
	<UChatPrompt
		v-bind="$attrs"
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
		:class="expanded && 'flex-1 min-h-0 rounded-none'"
		@submit="expanded = false; emit('submit', $event)"
	>
		<template #body="{ submit, placeholder: hint, disabled: off }">
			<UEditor
				:key="mode"
				v-slot="{ editor: instance }"
				:starter-kit="mode === 'rich'"
				:content-type="mode === 'rich' ? 'markdown' : undefined"
				:mention="false"
				:editable="!off"
				:placeholder="hint"
				:handlers="commandHandlers"
				:extensions="mode === 'rich' ? [promptExtension(submit), MarkdownMention, MarkdownPaste] : [promptExtension(submit), MarkdownMention]"
				class="w-full min-h-12 overflow-y-auto"
				:class="expanded ? 'flex-1 min-h-0' : 'max-h-60'"
				:ui="{ base: ['p-1.5! text-base', dictation !== 'idle' && '[&_.is-editor-empty]:before:italic'] }"
			>
				<UEditorToolbar v-if="mode === 'rich' && !off" :editor="instance" layout="bubble" :items="bubbleItems" :append-to="menuParent" :options="{ strategy: 'fixed', placement: 'top', offset: 8, flip: true, shift: { padding: 8 } }" />
				<UEditorSuggestionMenu v-if="commandItems.length" :editor="instance" :items="commandItems" :append-to="menuParent" :options="menuOptions" />
				<UEditorMentionMenu v-if="mentions.length" :editor="instance" :items="mentions" :limit="20" :append-to="menuParent" :options="menuOptions" />
			</UEditor>
		</template>

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
					v-model:images="images"
					:web-search-available="models.some(model => model.webSearch)"
					:switches="switches"
					:open="open"
				/>
				<UPopover v-if="memoryMax !== undefined" :content="{ side: 'top', align: 'start' }" @update:open="open => !open && commitMemory()">
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
				<slot name="tools" />
			</div>

			<div class="flex items-center gap-1 min-w-0">
				<UTooltip :text="expanded ? 'Exit full screen' : 'Full screen'">
					<UButton :icon="expanded ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'" size="sm" color="neutral" variant="ghost" :aria-label="expanded ? 'Exit full screen' : 'Full screen'" :aria-pressed="expanded" @click="toggleExpanded" />
				</UTooltip>
				<!-- Rich text or raw: the editor starts again in the other mode with what was written. -->
				<UFieldGroup>
					<UTooltip text="Rich text">
						<UButton icon="i-lucide-type" size="sm" color="neutral" :variant="mode === 'rich' ? 'soft' : 'ghost'" aria-label="Rich text" :aria-pressed="mode === 'rich'" @click="mode = 'rich'" />
					</UTooltip>
					<UTooltip text="Raw: sent exactly as typed">
						<UButton icon="i-lucide-code-xml" size="sm" color="neutral" :variant="mode === 'raw' ? 'soft' : 'ghost'" aria-label="Raw text" :aria-pressed="mode === 'raw'" @click="mode = 'raw'" />
					</UTooltip>
				</UFieldGroup>
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
	</div>
</template>
