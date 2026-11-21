<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { LANE_COLORS } from '#shared/utils/chat'
import { LazyChatModelEdit, LazyModelBrowser } from '#components'
import type { ChatLanes, Lane } from '~/composables/useChatLanes'

const props = defineProps<{
	chatLanes: ChatLanes
}>()

const { lanes, enabledLanes, settings, laneName, laneModel, saved, adding } = props.chatLanes
const { models, maxChatModels } = useModels()
// At the admin's limit, nothing more can be turned on or added until one is turned off.
const full = computed(() => enabledLanes.value.length >= maxChatModels.value)
const overlay = useOverlay()
const editor = overlay.create(LazyChatModelEdit)
const browser = overlay.create(LazyModelBrowser)

// Profiles for "Add model": shared with the home and profiles pages, and loaded after sign-in.
const open = ref(false)
const { data: profileList } = useQuery(modelProfilesQuery)
const profiles = computed(() => profileList.value ?? [])

const swatch = (color: Lane['color']) => color ? LANE_COLOR_CLASSES[color] : 'border border-dashed border-accented'
const swatchOf = (item: object) => 'swatch' in item && typeof item.swatch === 'string' ? item.swatch : ''
const levelLabels: Record<string, string> = { none: 'Off', on: 'On', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }

async function edit(lane: Lane) {
	const result = await editor.open({ lane, saved }).result
	if (!result) return
	if (result.action === 'remove') return props.chatLanes.remove(lane)
	await props.chatLanes.update(lane, result.fields)
	if (result.action === 'apply') await props.chatLanes.applyToProfile(lane)
}

async function addFromModel() {
	const modelId = await browser.open({ models: models.value, title: 'Add a model' }).result
	if (modelId) await props.chatLanes.add({ modelId })
}

function reasoningItems(lane: Lane): DropdownMenuItem[] {
	const model = laneModel(lane)
	if (!model?.reasoning) return []
	const levels = model.reasoningLevels.length ? model.reasoningLevels.filter(level => level !== 'none') : ['on']
	const choices = [undefined, ...(model.reasoning.mandatory ? [] : ['none']), ...levels]
	const current = lane.params.reasoningLevel
	return [{
		label: 'Thinking mode',
		icon: 'i-lucide-brain',
		children: choices.map(level => ({
			label: level ? levelLabels[level] ?? level : 'Default',
			type: 'checkbox' as const,
			checked: current === level,
			onSelect: () => props.chatLanes.update(lane, { params: { ...lane.params, reasoningLevel: level } }),
		})),
	}]
}

const items = computed<DropdownMenuItem[][]>(() => [
	lanes.value.map((lane, index) => ({
		label: laneName(lane),
		slot: 'lane' as const,
		swatch: swatch(lane.color),
		class: lane.enabled ? undefined : 'opacity-60',
		children: [[
			{ label: 'Edit...', icon: 'i-lucide-sliders-horizontal', onSelect: () => edit(lane) },
			{
				label: 'Answers',
				icon: 'i-lucide-power',
				type: 'checkbox' as const,
				checked: lane.enabled,
				disabled: !lane.enabled && full.value,
				onUpdateChecked: (checked: boolean) => props.chatLanes.update(lane, { enabled: checked }),
				onSelect: (e: Event) => e.preventDefault(),
			},
			...reasoningItems(lane),
			{
				label: 'Color label',
				icon: 'i-lucide-palette',
				children: [null, ...LANE_COLORS].map(color => ({
					label: color ? color.charAt(0).toUpperCase() + color.slice(1) : 'No color',
					slot: 'lane' as const,
					swatch: swatch(color),
					type: 'checkbox' as const,
					checked: lane.color === color,
					onSelect: () => props.chatLanes.update(lane, { color }),
				})),
			},
		], [
			{ label: 'Duplicate', icon: 'i-lucide-copy', disabled: lane.enabled && full.value, onSelect: () => props.chatLanes.duplicate(lane) },
			{ label: 'Move left', icon: 'i-lucide-arrow-left', disabled: index === 0, onSelect: () => props.chatLanes.move(lane, -1) },
			{ label: 'Move right', icon: 'i-lucide-arrow-right', disabled: index === lanes.value.length - 1, onSelect: () => props.chatLanes.move(lane, 1) },
		], [
			{ label: 'Delete', icon: 'i-lucide-trash', color: 'error' as const, disabled: lanes.value.length <= 1, onSelect: () => props.chatLanes.remove(lane) },
		]],
	})),
	[{
		label: full.value ? `Add model (${maxChatModels.value} answering at most)` : 'Add model',
		icon: 'i-lucide-plus',
		disabled: full.value,
		children: [
			...([['Your profiles', false], ['Instance profiles', true]] as const).map(([heading, instance]) => {
				const group = profiles.value.filter(profile => (profile.ownerId === null) === instance)
				return group.length
					? [{ type: 'label' as const, label: heading }, ...group.map(profile => ({
							label: profile.name,
							slot: 'lane' as const,
							swatch: swatch(profile.color),
							onSelect: () => props.chatLanes.add({ profile }),
						}))]
					: []
			}),
			[{ label: 'Choose a model...', icon: 'i-lucide-search', onSelect: addFromModel }],
		].filter(group => group.length),
	}],
	[
		{ label: 'Side by side', icon: 'i-lucide-columns-2', type: 'checkbox' as const, checked: settings.value.answerLayout !== 'stack', onSelect: () => props.chatLanes.setSettings({ answerLayout: 'columns' }) },
		{ label: 'Stacked', icon: 'i-lucide-rows-2', type: 'checkbox' as const, checked: settings.value.answerLayout === 'stack', onSelect: () => props.chatLanes.setSettings({ answerLayout: 'stack' }) },
	],
])

const label = computed(() => enabledLanes.value.length === 1 ? laneName(enabledLanes.value[0]!) : `${enabledLanes.value.length} models`)
</script>

<template>
	<UDropdownMenu v-model:open="open" :items="items" :content="{ align: 'start' }" :ui="{ content: 'w-60' }">
		<UButton color="neutral" variant="ghost" trailing-icon="i-lucide-chevron-down" class="data-[state=open]:bg-elevated min-w-0" :ui="{ label: 'truncate' }">
			<span class="flex -space-x-1 shrink-0">
				<span v-for="lane in enabledLanes.slice(0, 4)" :key="lane.id" :class="['size-3 rounded-full ring-2 ring-(--ui-bg)', swatch(lane.color)]" />
			</span>
			<span class="truncate max-w-48">{{ label }}</span>
			<UIcon v-if="adding" name="i-lucide-loader-circle" class="size-4 shrink-0 animate-spin text-dimmed" aria-label="Adding a model" />
		</UButton>

		<template #lane-leading="{ item }">
			<span :class="['size-3 rounded-full shrink-0 m-0.5', swatchOf(item)]" />
		</template>
	</UDropdownMenu>
</template>
