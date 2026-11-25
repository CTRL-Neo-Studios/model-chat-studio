<script setup lang="ts">
import { type Lore, LORE_LOGICS, LORE_POSITIONS, LORE_ROLES } from '#shared/utils/lorebook'

/**
 * A lorebook note's options under "Advanced", closed at first (milestone 9 plan, section 2b), each with what it does.
 * Changes are sent a moment after the last one, without the defaults; the card fields kept for export stay on the
 * server.
 */
const props = defineProps<{
	lore: Lore | null
	readonly?: boolean
}>()
const emit = defineEmits<{ save: [Lore] }>()

const DEFAULTS = {
	enabled: true, constant: false, secondaryKeys: [] as string[], logic: 'andAny' as Lore['logic'], caseSensitive: null as boolean | null,
	wholeWords: null as boolean | null, scanDepth: null as number | null, order: 100, priority: null as number | null,
	position: null as Lore['position'], depth: 4, role: 'system' as Lore['role'], preventRecursion: false, excludeRecursion: false,
	delayUntilRecursion: false, group: '', groupOverride: false, groupWeight: 100, groupScoring: false, probability: 100,
	sticky: 0, cooldown: 0, delay: 0, fuzzy: false, scanInstructions: false, scanUserCharacter: false,
}
type Draft = typeof DEFAULTS

const fromLore = (lore: Lore | null): Draft => {
	const { kept: _kept, ...options } = lore ?? {}
	return { ...DEFAULTS, ...options }
}
/** Only what differs from the defaults is stored. */
const toLore = (draft: Draft): Lore => Object.fromEntries(Object.entries(draft).filter(([key, value]) =>
	JSON.stringify(value) !== JSON.stringify(DEFAULTS[key as keyof Draft]))) as Lore

const draft = ref(fromLore(props.lore))
let timer: ReturnType<typeof setTimeout> | undefined
watch(draft, () => {
	clearTimeout(timer)
	timer = setTimeout(() => emit('save', toLore(draft.value)), 700)
}, { deep: true })
onBeforeUnmount(() => {
	if (timer) {
		clearTimeout(timer)
		emit('save', toLore(draft.value))
	}
})

const logicLabels: Record<(typeof LORE_LOGICS)[number], string> = { andAny: 'And any of these', andAll: 'And all of these', notAny: 'And none of these', notAll: 'And not all of these' }
const logicItems = LORE_LOGICS.map(value => ({ label: logicLabels[value], value }))
const positionLabels: Record<(typeof LORE_POSITIONS)[number] | 'default', string> = { default: 'With auto-fetched files', before: 'Before the instructions', after: 'After the instructions', depth: 'In the conversation' }
const positionItems = (['default', ...LORE_POSITIONS] as const).map(value => ({ label: positionLabels[value], value }))
const position = computed({
	get: () => draft.value.position ?? 'default',
	set: (value: string) => draft.value.position = value === 'default' ? null : value as Lore['position'],
})
const roleItems = LORE_ROLES.map(value => ({ label: value === 'system' ? 'System (sent as yours)' : value === 'user' ? 'You' : 'The model', value }))

/** A yes / no / default choice. */
const tristate = (key: 'caseSensitive' | 'wholeWords', labels: [string, string, string]) => ({
	items: [{ label: labels[0], value: 'default' }, { label: labels[1], value: 'yes' }, { label: labels[2], value: 'no' }],
	model: computed({
		get: () => draft.value[key] === null ? 'default' : draft.value[key] ? 'yes' : 'no',
		set: (value: string) => draft.value[key] = value === 'default' ? null : value === 'yes',
	}),
})
const caseChoice = tristate('caseSensitive', ['Any case (default)', 'Match case', 'Any case'])
const wordsChoice = tristate('wholeWords', ['Whole words for plain Latin (default)', 'Whole words only', 'Anywhere, even inside words'])
const caseModel = caseChoice.model
const wordsModel = wordsChoice.model

const kept = computed(() => {
	const { extensions, ...top } = props.lore?.kept ?? {}
	return [...Object.keys(top), ...Object.keys(typeof extensions === 'object' && extensions ? extensions : {})].join(', ')
})
</script>

<template>
	<UCollapsible :unmount-on-hide="false" class="border-b border-default">
		<UButton label="Advanced: lorebook options" color="neutral" variant="ghost" size="sm" trailing-icon="i-lucide-chevron-down" class="mx-4 my-1.5" :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform' }" />
		<template #content>
			<fieldset :disabled="readonly" class="grid gap-4 px-6 pb-4 sm:grid-cols-2">
				<USwitch v-model="draft.enabled" label="On" description="Off: never sent." />
				<USwitch v-model="draft.constant" label="Always sent" description="Sent with every answer, ahead of keyword matches." />

				<UFormField label="Also needs" help="Keywords checked once a main keyword matched." class="sm:col-span-2">
					<div class="flex flex-wrap gap-2">
						<USelect v-model="draft.logic" :items="logicItems" size="sm" class="w-48" />
						<UInputTags v-model="draft.secondaryKeys" placeholder="Add keywords" :max="50" :max-length="100" add-on-blur add-on-paste delimiter="," size="sm" class="flex-1 min-w-48" />
					</div>
				</UFormField>
				<UFormField label="Case" help="How keywords match letter case.">
					<USelect v-model="caseModel" :items="caseChoice.items" size="sm" class="w-full" />
				</UFormField>
				<UFormField label="Words" help="Whether a keyword must stand as a whole word.">
					<USelect v-model="wordsModel" :items="wordsChoice.items" size="sm" class="w-full" />
				</UFormField>
				<UFormField label="Latest messages searched" help="Empty: the lorebook's setting.">
					<UInputNumber v-model="draft.scanDepth" :min="0" :max="100" placeholder="Lorebook's" size="sm" />
				</UFormField>
				<div class="flex flex-col gap-2">
					<USwitch v-model="draft.scanInstructions" label="Also search the Character's instructions" />
					<USwitch v-model="draft.scanUserCharacter" label="Also search your Character" />
					<USwitch v-model="draft.fuzzy" label="Also match by its text" description="Found when the conversation shares words with the note." />
				</div>

				<UFormField label="Where it goes" help="In the instructions, some messages up in the conversation, or with auto-fetched files (after the conversation, or where the structure profile puts them).">
					<USelect v-model="position" :items="positionItems" size="sm" class="w-full" />
				</UFormField>
				<div v-if="draft.position === 'depth'" class="flex gap-2">
					<UFormField label="Messages up" help="0: after the last one.">
						<UInputNumber v-model="draft.depth" :min="0" :max="1000" size="sm" />
					</UFormField>
					<UFormField label="Said by">
						<USelect v-model="draft.role" :items="roleItems" size="sm" class="w-40" />
					</UFormField>
				</div>
				<div v-else />
				<UFormField label="Order" help="Notes are sent lowest first.">
					<UInputNumber v-model="draft.order" :min="-1000000" :max="1000000" size="sm" />
				</UFormField>
				<UFormField label="Priority" help="Over budget, the lowest go first. Empty: its order.">
					<UInputNumber v-model="draft.priority" :min="-1000000" :max="1000000" placeholder="Order" size="sm" />
				</UFormField>

				<UFormField label="Chance" help="Percent: how often it is sent when it matches.">
					<UInputNumber v-model="draft.probability" :min="0" :max="100" size="sm" />
				</UFormField>
				<div class="grid grid-cols-3 gap-2">
					<UFormField label="Sticky" help="Stays this many messages.">
						<UInputNumber v-model="draft.sticky" :min="0" :max="1000" size="sm" />
					</UFormField>
					<UFormField label="Cooldown" help="Then waits this many.">
						<UInputNumber v-model="draft.cooldown" :min="0" :max="1000" size="sm" />
					</UFormField>
					<UFormField label="Delay" help="Not before the chat has this many.">
						<UInputNumber v-model="draft.delay" :min="0" :max="1000" size="sm" />
					</UFormField>
				</div>

				<div class="flex flex-col gap-2">
					<USwitch v-model="draft.preventRecursion" label="Its text brings in no other notes" />
					<USwitch v-model="draft.excludeRecursion" label="Not brought in by other notes" />
					<USwitch v-model="draft.delayUntilRecursion" label="Only brought in by other notes" />
				</div>
				<div class="flex flex-col gap-2">
					<UFormField label="Group" help="Comma-separated: of the notes in a group, one is sent.">
						<UInput v-model="draft.group" :maxlength="200" placeholder="None" size="sm" class="w-full" />
					</UFormField>
					<template v-if="draft.group.trim()">
						<USwitch v-model="draft.groupOverride" label="Wins its group" />
						<USwitch v-model="draft.groupScoring" label="Most matched keywords win" />
						<UFormField label="Weight" help="Its chance of winning otherwise.">
							<UInputNumber v-model="draft.groupWeight" :min="1" :max="10000" size="sm" />
						</UFormField>
					</template>
				</div>

				<p v-if="kept" class="text-xs text-muted sm:col-span-2">
					Kept from the card for export, not used here: {{ kept }}.
				</p>
			</fieldset>
		</template>
	</UCollapsible>
</template>
