<script setup lang="ts">
import type { ContextBlock } from '#shared/utils/chat'
import type { ChatMessage } from '~/composables/useLaneAnswers'

/**
 * The conversation overview, owner only: what each answer was given and did (trajectory), the chat's files, and
 * its token use (context). Answers' figures are as the platform reported them; the split of an answer's input
 * across its blocks is an estimate from their sizes (about four characters per token).
 */
const props = withDefaults(defineProps<{
	chatId: string
	messages: ChatMessage[]
	/** The chat's libraries the reader may change: the chat's files can be added to them. */
	libraries?: { id: string, name: string }[]
}>(), { libraries: () => [] })

const open = defineModel<boolean>('open', { default: false })

const { data, isPending, error } = useQuery(() => ({ ...chatOverviewQuery(props.chatId), enabled: open.value }))
const { models } = useModels()
const act = useApiAction()
const queryCache = useQueryCache()

/** "Add to library": a copy of the upload goes to the top of the library. */
const adding = ref<string | null>(null)
async function addToLibrary(fileId: string, libraryId: string) {
	adding.value = fileId
	const added = await act(`/api/v1/libraries/${libraryId}/files/from-chat`, { method: 'POST', body: { fileId }, success: 'Added to the library' })
	adding.value = null
	if (added) queryCache.invalidateQueries({ key: libraryEntriesQuery(libraryId).key })
}

const tab = ref<'trajectory' | 'files' | 'context'>('trajectory')
const tabs = [
	{ label: 'Trajectory', value: 'trajectory', icon: 'i-lucide-route' },
	{ label: 'Files', value: 'files', icon: 'i-lucide-paperclip' },
	{ label: 'Context', value: 'context', icon: 'i-lucide-gauge' },
]

const byId = computed(() => Object.fromEntries(props.messages.map(message => [message.id, message])))
const textOf = (message?: ChatMessage) => message?.parts.map(part => part.type === 'text' ? part.text : '').join('') ?? ''
const estimate = (characters: number) => Math.ceil(characters / 4)
const number = (value?: number | null) => (value ?? 0).toLocaleString('en-US')
const laneOf = (message: ChatMessage) => message.metadata?.lane?.name ?? message.metadata?.model ?? 'Model'

/** Each traced answer with what it was given, in chat order. */
const turns = computed(() => (data.value?.traces ?? []).flatMap((trace) => {
	const answer = byId.value[trace.messageId]
	if (!answer) return []
	const tools = answer.parts.flatMap(part => part.type.startsWith('tool-') && 'input' in part
		? [{ name: part.type.slice(5), input: part.input, output: 'output' in part ? part.output : undefined }]
		: [])
	return [{ answer, blocks: trace.blocks as ContextBlock[], tools, lane: laneOf(answer) }]
}))
type Turn = (typeof turns.value)[number]

// Trajectory: one row per block, then the answer's tool calls and the answer. Rows open to the full text.
const search = ref('')
interface Row { key: string, role: string, label: string, detail?: string, text: string }
const rowsOf = (turn: Turn): Row[] => [
	...turn.blocks.map((block, index) => ({
		key: `${turn.answer.id}:${index}`,
		role: block.role,
		label: block.kind === 'reference' ? `@${block.label}` : block.label,
		detail: block.kind === 'omitted' || (block.kind === 'reference' && !block.size) ? undefined : `~${number(estimate(block.size))} tokens`,
		text: block.text ?? (block.kind === 'reference' ? 'From the library, read when this answer was made.' : textOf(byId.value[block.messageId ?? ''])),
	})),
	...turn.tools.map((tool, index) => ({
		key: `${turn.answer.id}:tool:${index}`,
		role: 'tool',
		label: `Tool: ${tool.name}`,
		text: `Input:\n${JSON.stringify(tool.input, null, 2)}${tool.output === undefined ? '' : `\n\nResult:\n${JSON.stringify(tool.output, null, 2)}`}`,
	})),
	{
		key: `${turn.answer.id}:answer`,
		role: 'assistant',
		label: `Answer by ${turn.lane}`,
		detail: `${number(turn.answer.metadata?.outputTokens)} tokens`,
		text: textOf(turn.answer),
	},
]
const shownTurns = computed(() => {
	const term = search.value.trim().toLowerCase()
	return turns.value.map(turn => ({ turn, rows: rowsOf(turn).filter(row => !term || `${row.label}\n${row.text}`.toLowerCase().includes(term)) }))
		.filter(entry => entry.rows.length)
})
const roleColors: Record<string, 'neutral' | 'info' | 'primary' | 'warning'> = { system: 'neutral', user: 'info', assistant: 'primary', tool: 'warning' }

// Files.
const fileSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
const fileMessage = (messageId: string | null) => messageId ? (textOf(byId.value[messageId]).slice(0, 60) || 'A message without text') : 'Not sent yet'

// Context: totals for the chat and per lane, and what the next message would roughly send.
const answers = computed(() => props.messages.filter(message => message.role === 'assistant' && message.metadata?.model))
const sumOf = (list: ChatMessage[]) => list.reduce((totals, message) => ({
	answers: totals.answers + 1,
	inputTokens: totals.inputTokens + (message.metadata?.inputTokens ?? 0),
	cachedInputTokens: totals.cachedInputTokens + (message.metadata?.cachedInputTokens ?? 0),
	outputTokens: totals.outputTokens + (message.metadata?.outputTokens ?? 0),
	reasoningTokens: totals.reasoningTokens + (message.metadata?.reasoningTokens ?? 0),
	costUsd: totals.costUsd + (message.metadata?.costUsd ?? 0),
}), { answers: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0 })
const chatTotals = computed(() => sumOf(answers.value))
const ledgerChat = computed(() => data.value?.usage.find(row => row.kind === 'chat'))
const lanes = computed(() => [...new Set(answers.value.map(laneOf))].map((name) => {
	const own = answers.value.filter(message => laneOf(message) === name)
	const last = own.at(-1)
	const window = models.value.find(model => model.id === last?.metadata?.model)?.contextLength ?? null
	// The next message sends about what the last one did, plus its answer.
	const next = (last?.metadata?.inputTokens ?? 0) + (last?.metadata?.outputTokens ?? 0)
	return { name, totals: sumOf(own), next, window }
}))

/** An answer's input split across its blocks by size: instructions, summary, earlier messages, the new message and its references. */
function split(turn: Turn) {
	const last = turn.blocks.findLastIndex(block => block.kind === 'message')
	const size = (test: (block: ContextBlock, index: number) => boolean) =>
		turn.blocks.reduce((total, block, index) => total + (test(block, index) ? block.size : 0), 0)
	return [
		{ label: 'Instructions', size: size(block => block.kind === 'instructions'), class: 'bg-(--ui-border-accented)' },
		{ label: 'Summary', size: size(block => block.kind === 'summary'), class: 'bg-warning' },
		{ label: 'Earlier messages', size: size((block, index) => block.kind === 'message' && index < last), class: 'bg-info' },
		{ label: 'New message', size: size((block, index) => block.kind === 'message' && index === last), class: 'bg-primary' },
		{ label: 'Library files ("@" and auto-fetch)', size: size(block => block.kind === 'reference' || block.kind === 'autoFetch'), class: 'bg-success' },
		{ label: 'Structure profile blocks', size: size(block => block.kind === 'profile'), class: 'bg-secondary' },
	].filter(part => part.size > 0)
}
</script>

<template>
	<USlideover v-model:open="open" title="Conversation overview" :ui="{ content: 'sm:max-w-2xl', body: 'flex flex-col gap-4' }">
		<template #body>
			<UTabs v-model="tab" :items="tabs" :content="false" class="w-full" />

			<div v-if="isPending" class="flex flex-col gap-2" aria-busy="true" aria-label="Loading the overview">
				<USkeleton v-for="n in 5" :key="n" class="h-10 w-full" />
			</div>
			<UAlert v-else-if="error" color="error" variant="subtle" icon="i-lucide-alert-circle" title="The overview could not be loaded" :description="serverMessage(error)" />

			<template v-else-if="tab === 'trajectory'">
				<UInput v-model="search" icon="i-lucide-search" placeholder="Search the trajectory" />
				<p v-if="!shownTurns.length" class="text-sm text-muted">
					{{ turns.length ? 'Nothing matches.' : 'No answer has a trace yet: answers given from now on are recorded.' }}
				</p>
				<section v-for="{ turn, rows } in shownTurns" :key="turn.answer.id" class="flex flex-col gap-1.5">
					<div class="flex items-center gap-2 text-xs text-muted">
						<span class="font-medium text-highlighted">{{ turn.lane }}</span>
						<span>{{ number(turn.answer.metadata?.inputTokens) }} in · {{ number(turn.answer.metadata?.outputTokens) }} out</span>
						<span v-if="turn.tools.length">· {{ turn.tools.length }} {{ turn.tools.length === 1 ? 'tool call' : 'tool calls' }}</span>
						<span v-if="turn.answer.metadata?.durationMs">· {{ (turn.answer.metadata.durationMs / 1000).toFixed(1) }} s</span>
					</div>
					<div class="flex h-1.5 rounded-full overflow-hidden bg-elevated" aria-hidden="true">
						<div class="bg-info" :style="{ flex: turn.answer.metadata?.inputTokens ?? 0 }" />
						<div class="bg-primary" :style="{ flex: turn.answer.metadata?.outputTokens ?? 0 }" />
					</div>
					<UCollapsible v-for="row in rows" :key="row.key" class="rounded-md border border-default">
						<button type="button" class="w-full flex items-center gap-2 px-3 py-2 text-sm text-start">
							<UBadge :label="row.role" :color="roleColors[row.role] ?? 'neutral'" variant="subtle" size="sm" class="shrink-0" />
							<span class="truncate flex-1 text-highlighted">{{ row.label }}</span>
							<span v-if="row.detail" class="text-xs text-muted shrink-0">{{ row.detail }}</span>
						</button>
						<template #content>
							<pre class="px-3 pb-3 text-xs text-muted whitespace-pre-wrap break-words max-h-80 overflow-y-auto">{{ row.text || '(no text)' }}</pre>
						</template>
					</UCollapsible>
				</section>
			</template>

			<template v-else-if="tab === 'files'">
				<p v-if="!data?.files.length" class="text-sm text-muted">
					No files in this chat.
				</p>
				<ul v-else class="flex flex-col divide-y divide-default rounded-md border border-default">
					<li v-for="file in data.files" :key="file.id" class="flex items-center gap-3 px-3 py-2 text-sm">
						<UIcon :name="getFileIcon(file.mediaType)" class="size-5 shrink-0 text-muted" />
						<div class="flex flex-col min-w-0 flex-1">
							<a :href="file.url" target="_blank" class="truncate text-highlighted hover:underline">{{ file.fileName ?? 'file' }}</a>
							<span class="text-xs text-muted truncate">{{ fileMessage(file.messageId) }}</span>
						</div>
						<span class="text-xs text-muted shrink-0">{{ file.mediaType }} · {{ fileSize(file.size) }}</span>
						<!-- One library: a button; several: a menu to pick which. -->
						<UButton
							v-if="libraries.length === 1"
							icon="i-lucide-folder-input"
							label="Add to library"
							color="neutral"
							variant="subtle"
							size="xs"
							:loading="adding === file.id"
							@click="addToLibrary(file.id, libraries[0]!.id)"
						/>
						<UDropdownMenu
							v-else-if="libraries.length"
							:items="libraries.map(library => ({ label: library.name, icon: 'i-lucide-library-big', onSelect: () => addToLibrary(file.id, library.id) }))"
							:content="{ align: 'end' }"
						>
							<UButton icon="i-lucide-folder-input" label="Add to library" trailing-icon="i-lucide-chevron-down" color="neutral" variant="subtle" size="xs" :loading="adding === file.id" />
						</UDropdownMenu>
					</li>
				</ul>
			</template>

			<template v-else>
				<UPageCard title="Chat" variant="subtle">
					<p class="text-sm">
						{{ chatTotals.answers }} answers: {{ number(chatTotals.inputTokens) }} input ({{ number(chatTotals.cachedInputTokens) }} cached),
						{{ number(chatTotals.outputTokens) }} output ({{ number(chatTotals.reasoningTokens) }} reasoning), {{ formatUsd(chatTotals.costUsd) }}
					</p>
					<p v-if="ledgerChat" class="text-xs text-muted">
						Spend ledger for this chat's answers, replaced and deleted ones included: {{ ledgerChat.calls }} calls, {{ number(ledgerChat.inputTokens) }} input,
						{{ number(ledgerChat.outputTokens) }} output, {{ formatUsd(ledgerChat.costUsd ?? 0) }}.
						<template v-for="row in data?.usage.filter(entry => entry.kind !== 'chat')" :key="row.kind">
							{{ row.kind }}: {{ row.calls }} calls, {{ formatUsd(row.costUsd ?? 0) }}.
						</template>
					</p>
				</UPageCard>

				<UPageCard v-for="lane in lanes" :key="lane.name" :title="lane.name" variant="subtle">
					<p class="text-sm">
						{{ lane.totals.answers }} answers: {{ number(lane.totals.inputTokens) }} input, {{ number(lane.totals.outputTokens) }} output, {{ formatUsd(lane.totals.costUsd) }}
					</p>
					<div v-if="lane.window" class="flex flex-col gap-1">
						<UProgress :model-value="Math.min(100, lane.next / lane.window * 100)" :color="lane.next / lane.window > 0.8 ? 'warning' : 'primary'" />
						<span class="text-xs text-muted">The next message sends roughly {{ number(lane.next) }} of the model's {{ number(lane.window) }} tokens.</span>
					</div>
				</UPageCard>

				<section v-if="turns.length" class="flex flex-col gap-2">
					<h3 class="text-sm font-medium text-highlighted">
						Input per answer, split by size (estimate)
					</h3>
					<div v-for="turn in turns" :key="turn.answer.id" class="flex flex-col gap-1">
						<div class="flex justify-between gap-2 text-xs text-muted">
							<span>{{ turn.lane }}</span>
							<span>{{ number(turn.answer.metadata?.inputTokens) }} in · {{ number(turn.answer.metadata?.cachedInputTokens) }} cached · {{ number(turn.answer.metadata?.outputTokens) }} out · {{ turn.answer.metadata?.costUsd == null ? 'cost unknown' : formatUsd(turn.answer.metadata.costUsd) }}</span>
						</div>
						<div class="flex h-2 rounded-full overflow-hidden bg-elevated">
							<UTooltip v-for="part in split(turn)" :key="part.label" :text="`${part.label}: ~${number(estimate(part.size))} tokens`">
								<div :class="part.class" :style="{ flex: part.size }" />
							</UTooltip>
						</div>
					</div>
				</section>
			</template>
		</template>
	</USlideover>
</template>
