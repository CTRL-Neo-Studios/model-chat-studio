<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { ProfileBlock } from '#shared/utils/structureProfile'

interface Draft { name: string, blocks: ProfileBlock[] }

const props = defineProps<{
	title: string
	profile: Draft
}>()

/** The edited profile, or nothing when cancelled. */
const emit = defineEmits<{ close: [profile?: Draft] }>()

const draft = ref<Draft>(structuredClone(toRaw(props.profile)))
const valid = computed(() => !!draft.value.name.trim() && draft.value.blocks.length <= 30)

const newId = () => crypto.randomUUID()
const roles = [
	{ label: 'System', value: 'system' },
	{ label: 'User', value: 'user' },
	{ label: 'Assistant', value: 'assistant' },
]
const hasAutoFetch = computed(() => draft.value.blocks.some(block => block.kind === 'autoFetch'))
const addItems = computed<DropdownMenuItem[]>(() => [
	{ label: 'Message', icon: 'i-lucide-message-square-text', onSelect: () => add({ id: newId(), kind: 'message', role: 'user', text: '' }) },
	{ label: 'Library files', icon: 'i-lucide-files', onSelect: () => add({ id: newId(), kind: 'files', paths: [] }) },
	{ label: 'Auto-fetched files', icon: 'i-lucide-folder-search', disabled: hasAutoFetch.value, onSelect: () => add({ id: newId(), kind: 'autoFetch' }) },
])
const add = (block: ProfileBlock) => {
	draft.value.blocks = [...draft.value.blocks, block]
}
const remove = (index: number) => {
	draft.value.blocks = draft.value.blocks.toSpliced(index, 1)
}
function move(from: number, to: number) {
	if (to < 0 || to >= draft.value.blocks.length || from === to) return
	const blocks = [...draft.value.blocks]
	const [block] = blocks.splice(from, 1)
	blocks.splice(to, 0, block!)
	draft.value.blocks = blocks
}

// Drag by the handle; the arrows do the same from the keyboard.
const dragging = ref<number | null>(null)
const over = ref<number | null>(null)
function onDrop(index: number) {
	if (dragging.value !== null) move(dragging.value, index)
	dragging.value = over.value = null
}

const label: Record<ProfileBlock['kind'], string> = { message: 'Message', history: 'Conversation', autoFetch: 'Auto-fetched files', files: 'Library files' }
const icon: Record<ProfileBlock['kind'], string> = { message: 'i-lucide-message-square-text', history: 'i-lucide-messages-square', autoFetch: 'i-lucide-folder-search', files: 'i-lucide-files' }
const estimate = (text: string) => Math.ceil(text.length / 4)
</script>

<template>
	<UModal :title="title" :ui="{ content: 'sm:max-w-2xl', footer: 'justify-end' }" @update:open="emit('close')">
		<template #body>
			<div class="flex flex-col gap-4">
				<UFormField label="Name" required>
					<UInput v-model="draft.name" :maxlength="100" placeholder="e.g. Roleplay, Code review" class="w-full" />
				</UFormField>
				<p class="text-sm text-muted">
					Blocks are sent in this order, around the conversation. System messages at the very top become the instructions; later ones are sent as user messages.
				</p>

				<ol class="flex flex-col gap-2">
					<li
						v-for="(block, index) in draft.blocks"
						:key="block.id"
						:class="['rounded-md border border-default p-3 flex flex-col gap-2 bg-default', over === index && dragging !== index && 'ring-2 ring-primary', dragging === index && 'opacity-50']"
						@dragover.prevent="over = index"
						@dragleave="over = over === index ? null : over"
						@drop.prevent="onDrop(index)"
					>
						<div class="flex items-center gap-2">
							<span
								draggable="true"
								class="cursor-grab text-dimmed"
								:aria-label="`Drag ${label[block.kind]} block`"
								@dragstart="dragging = index"
								@dragend="dragging = over = null"
							><UIcon name="i-lucide-grip-vertical" class="size-4" /></span>
							<UIcon :name="icon[block.kind]" class="size-4 text-muted" />
							<span class="text-sm font-medium text-highlighted flex-1">{{ label[block.kind] }}</span>
							<USelect v-if="block.kind === 'message'" v-model="block.role" :items="roles" size="xs" class="w-32" aria-label="Role" />
							<UButton icon="i-lucide-arrow-up" color="neutral" variant="ghost" size="xs" aria-label="Move up" :disabled="index === 0" @click="move(index, index - 1)" />
							<UButton icon="i-lucide-arrow-down" color="neutral" variant="ghost" size="xs" aria-label="Move down" :disabled="index === draft.blocks.length - 1" @click="move(index, index + 1)" />
							<UButton v-if="block.kind !== 'history'" icon="i-lucide-trash" color="neutral" variant="ghost" size="xs" aria-label="Remove block" @click="remove(index)" />
						</div>
						<template v-if="block.kind === 'message'">
							<UTextarea v-model="block.text" :rows="3" autoresize :maxlength="50000" placeholder="What this message says" class="w-full" />
							<span class="text-xs text-dimmed self-end">~{{ estimate(block.text) }} tokens</span>
						</template>
						<p v-else-if="block.kind === 'history'" class="text-xs text-muted">
							The chat's messages, as the memory setting cuts them. Not editable.
						</p>
						<p v-else-if="block.kind === 'autoFetch'" class="text-xs text-muted">
							Where the files auto-fetch finds go. Without this block they go at the end.
						</p>
						<template v-else>
							<UInputTags v-model="block.paths" placeholder="A path, e.g. docs/conventions.md" add-on-blur add-on-paste :max="50" class="w-full" />
							<p class="text-xs text-muted">
								Sent with every answer, from the chat's library. A folder brings everything inside it; a path the library does not have is skipped.
							</p>
						</template>
					</li>
				</ol>

				<UDropdownMenu :items="addItems">
					<UButton icon="i-lucide-plus" label="Add a block" color="neutral" variant="subtle" class="self-start" :disabled="draft.blocks.length >= 30" />
				</UDropdownMenu>
			</div>
		</template>
		<template #footer>
			<UButton color="neutral" variant="ghost" label="Cancel" @click="emit('close')" />
			<UButton label="Save" :disabled="!valid" @click="emit('close', draft)" />
		</template>
	</UModal>
</template>
