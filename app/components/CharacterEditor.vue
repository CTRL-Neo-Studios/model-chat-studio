<script setup lang="ts">
import { LANE_COLORS } from '#shared/utils/chat'
import type { CharacterFields } from '#shared/utils/character'

const props = defineProps<{
	title: string
	character: CharacterFields
}>()

/** The edited Character, or nothing when cancelled. */
const emit = defineEmits<{ close: [character?: CharacterFields] }>()

const draft = ref<CharacterFields>(structuredClone(toRaw(props.character)))
const valid = computed(() => !!draft.value.name.trim())

const colorItems = [
	{ label: 'No color', value: null, swatch: 'border border-dashed border-accented' },
	...LANE_COLORS.map(color => ({ label: color.charAt(0).toUpperCase() + color.slice(1), value: color, swatch: LANE_COLOR_CLASSES[color] })),
]

const MAX_LIBRARIES = 5
const { data: libraryList } = useQuery(librariesQuery)
const libraryItems = computed(() => (libraryList.value ?? []).map(library => ({
	label: library.name,
	value: library.id,
	disabled: draft.value.libraryIds.length >= MAX_LIBRARIES && !draft.value.libraryIds.includes(library.id),
})))
const tokens = computed(() => Math.ceil(draft.value.instructions.length / 4))
</script>

<template>
	<UModal :title="title" :ui="{ content: 'sm:max-w-2xl', footer: 'justify-end' }" @update:open="emit('close')">
		<template #body>
			<div class="flex flex-col gap-5">
				<div class="flex items-center gap-2">
					<UPopover :content="{ align: 'start' }">
						<UButton color="neutral" variant="outline" square aria-label="Color label" class="size-9 justify-center">
							<span :class="['size-4 rounded-full', draft.color ? LANE_COLOR_CLASSES[draft.color] : 'border border-dashed border-accented']" />
						</UButton>
						<template #content>
							<div class="grid grid-cols-6 gap-1.5 p-2">
								<UTooltip v-for="item in colorItems" :key="item.label" :text="item.label">
									<UButton color="neutral" :variant="draft.color === item.value ? 'soft' : 'ghost'" square :aria-label="item.label" class="size-8 justify-center" @click="draft.color = item.value">
										<span :class="['size-4 rounded-full', item.swatch]" />
									</UButton>
								</UTooltip>
							</div>
						</template>
					</UPopover>
					<UInput v-model="draft.name" placeholder="Name, e.g. Engineer" :maxlength="60" class="flex-1" aria-label="Name" />
				</div>

				<UFormField label="Instructions" :help="`About ${tokens.toLocaleString('en-US')} tokens. {{char}} is this Character's name, {{user}} the user's.`">
					<UTextarea
						v-model="draft.instructions"
						autoresize
						:rows="6"
						:maxrows="16"
						:maxlength="20000"
						placeholder="e.g. You are {{char}}, a senior engineer. Explain trade-offs to {{user}} plainly."
						class="w-full"
					/>
				</UFormField>

				<UFormField label="Libraries" :help="`Read by this Character's model only, in every chat it joins. At most ${MAX_LIBRARIES}.`">
					<USelectMenu v-model="draft.libraryIds" :items="libraryItems" value-key="value" multiple placeholder="No library" icon="i-lucide-library-big" class="w-full" />
				</UFormField>
			</div>
		</template>
		<template #footer>
			<UButton color="neutral" variant="ghost" label="Cancel" @click="emit('close')" />
			<UButton label="Save" :disabled="!valid" @click="emit('close', { ...draft, name: draft.name.trim() })" />
		</template>
	</UModal>
</template>
