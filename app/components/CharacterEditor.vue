<script setup lang="ts">
import { LANE_COLORS } from '#shared/utils/chat'
import { CHARACTER_TEXT_MAX, type CharacterFields } from '#shared/utils/character'

const props = defineProps<{
	title: string
	character: CharacterFields
	/** The current avatar's URL. */
	avatar?: string
}>()

/**
 * The edited Character and its avatar (a new image, `null` to remove it, absent to keep it), or nothing when
 * cancelled. The avatar is sent once the Character is saved.
 */
const emit = defineEmits<{ close: [result?: { fields: CharacterFields, avatar?: File | null }] }>()

const draft = ref<CharacterFields>(structuredClone(toRaw(props.character)))
const valid = computed(() => !!draft.value.name.trim() && draft.value.greetings.every(greeting => greeting.trim()))

const colorItems = [
	{ label: 'No color', value: null, swatch: 'border border-dashed border-accented' },
	...LANE_COLORS.map(color => ({ label: color.charAt(0).toUpperCase() + color.slice(1), value: color, swatch: LANE_COLOR_CLASSES[color] })),
]

const tab = ref('instructions')
const tabs = [
	{ label: 'Instructions', value: 'instructions', slot: 'instructions' as const },
	{ label: 'Greetings', value: 'greetings', slot: 'greetings' as const },
	{ label: 'Examples and note', value: 'examples', slot: 'examples' as const },
	{ label: 'Lorebook', value: 'lorebook', slot: 'lorebook' as const },
	{ label: 'About', value: 'about', slot: 'about' as const },
]

const MAX_LIBRARIES = 5
const { data: libraryList } = useQuery(librariesQuery)
const libraryItems = computed(() => (libraryList.value ?? []).map(library => ({
	label: library.name,
	value: library.id,
	disabled: draft.value.libraryIds.length >= MAX_LIBRARIES && !draft.value.libraryIds.includes(library.id),
})))
const chosenLibraries = computed(() => draft.value.libraryIds.flatMap(id => (libraryList.value ?? []).filter(library => library.id === id)))
const tokens = (text: string) => Math.ceil(text.length / 4).toLocaleString('en-US')

// The avatar: a picked image shows at once; it is uploaded when the Character is saved.
const avatarFile = ref<File | null>()
const avatarPreview = ref<string>()
const avatarShown = computed(() => avatarFile.value === null ? undefined : avatarPreview.value ?? props.avatar)
const picker = ref<HTMLInputElement>()
const toast = useToast()
function pickAvatar(event: Event) {
	const file = (event.target as HTMLInputElement).files?.[0]
	if (!file) return
	if (file.size > 2 * 1024 * 1024) return toast.add({ description: 'An avatar can be at most 2 MB', icon: 'i-lucide-alert-circle', color: 'warning' })
	if (avatarPreview.value) URL.revokeObjectURL(avatarPreview.value)
	avatarFile.value = file
	avatarPreview.value = URL.createObjectURL(file)
}
function removeAvatar() {
	if (avatarPreview.value) URL.revokeObjectURL(avatarPreview.value)
	avatarPreview.value = undefined
	avatarFile.value = props.avatar ? null : undefined
}
onBeforeUnmount(() => avatarPreview.value && URL.revokeObjectURL(avatarPreview.value))

function save() {
	emit('close', { fields: { ...draft.value, name: draft.value.name.trim() }, ...(avatarFile.value !== undefined && { avatar: avatarFile.value }) })
}
</script>

<template>
	<UModal :title="title" :ui="{ content: 'sm:max-w-2xl', footer: 'justify-end' }" @update:open="emit('close')">
		<template #body>
			<div class="flex flex-col gap-4">
				<div class="flex items-center gap-2">
					<UPopover :content="{ align: 'start' }">
						<UButton color="neutral" variant="outline" square aria-label="Color label" class="size-9 justify-center">
							<LaneDot :color="draft.color" :avatar="avatarShown" avatar-class="size-7" dot-class="size-4" />
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

				<UTabs v-model="tab" :items="tabs" variant="link" class="w-full" :ui="{ content: 'pt-3' }">
					<template #instructions>
						<UFormField label="Instructions" :help="`About ${tokens(draft.instructions)} tokens. They take the place of the system prompt. {{char}} is this Character's name, {{user}} the user's.`">
							<UTextarea v-model="draft.instructions" autoresize :rows="6" :maxrows="16" :maxlength="CHARACTER_TEXT_MAX" placeholder="e.g. You are {{char}}, a senior engineer. Explain trade-offs to {{user}} plainly." class="w-full" />
						</UFormField>
					</template>

					<template #greetings>
						<div class="flex flex-col gap-3">
							<p class="text-sm text-muted">
								A chat started with this Character opens with the first greeting, as its first answer; the others are versions of it to flip to.
							</p>
							<div v-for="(_, index) in draft.greetings" :key="index" class="flex items-start gap-2">
								<UTextarea v-model="draft.greetings[index]" autoresize :rows="2" :maxrows="10" :maxlength="CHARACTER_TEXT_MAX" :placeholder="index ? 'Another greeting' : 'e.g. *{{char}} looks up from the map.* You made it, {{user}}.'" :aria-label="`Greeting ${index + 1}`" class="flex-1" />
								<UButton icon="i-lucide-x" color="neutral" variant="ghost" :aria-label="`Remove greeting ${index + 1}`" @click="draft.greetings.splice(index, 1)" />
							</div>
							<UButton icon="i-lucide-plus" :label="draft.greetings.length ? 'Add another greeting' : 'Add a greeting'" color="neutral" variant="outline" class="self-start" :disabled="draft.greetings.length >= 50" @click="draft.greetings.push('')" />
						</div>
					</template>

					<template #examples>
						<div class="flex flex-col gap-4">
							<UFormField label="Example dialogue" :help="`Sent after the instructions, as written: how {{char}} talks. About ${tokens(draft.examples)} tokens.`">
								<UTextarea v-model="draft.examples" autoresize :rows="5" :maxrows="14" :maxlength="CHARACTER_TEXT_MAX" placeholder="{{user}}: Is it safe?&#10;{{char}}: Safe enough, if you keep to the path." class="w-full" />
							</UFormField>
							<UFormField label="Closing note" :help="`Sent after the conversation on every turn, as a reminder: style, length, what to keep in mind. About ${tokens(draft.note)} tokens.`">
								<UTextarea v-model="draft.note" autoresize :rows="2" :maxrows="8" :maxlength="CHARACTER_TEXT_MAX" placeholder="e.g. Stay in character. Keep answers under three paragraphs." class="w-full" />
							</UFormField>
						</div>
					</template>

					<template #lorebook>
						<div class="flex flex-col gap-3">
							<UFormField label="Libraries" :help="`Read by this Character's model only, in every chat it joins. At most ${MAX_LIBRARIES}.`">
								<USelectMenu v-model="draft.libraryIds" :items="libraryItems" value-key="value" multiple placeholder="No library" icon="i-lucide-library-big" class="w-full" />
							</UFormField>
							<div v-if="chosenLibraries.length" class="flex flex-wrap gap-2">
								<UButton v-for="library in chosenLibraries" :key="library.id" :to="`/content/libraries/${library.id}`" target="_blank" :label="library.name" icon="i-lucide-library-big" trailing-icon="i-lucide-external-link" color="neutral" variant="subtle" size="xs" />
							</div>
						</div>
					</template>

					<template #about>
						<div class="flex flex-col gap-4">
							<UFormField label="Avatar" help="PNG, JPEG or WebP, at most 2 MB. Shown wherever this Character answers; the colour dot shows without one.">
								<div class="flex items-center gap-3">
									<LaneDot :color="draft.color" :avatar="avatarShown" avatar-class="size-16" dot-class="size-4 m-6" />
									<input ref="picker" type="file" accept="image/png,image/jpeg,image/webp" class="hidden" @change="pickAvatar">
									<UButton :label="avatarShown ? 'Change' : 'Choose an image'" icon="i-lucide-image-plus" color="neutral" variant="outline" size="sm" @click="picker?.click()" />
									<UButton v-if="avatarShown" label="Remove" color="neutral" variant="ghost" size="sm" @click="removeAvatar" />
								</div>
							</UFormField>
							<UFormField label="Creator's notes" help="Shown here only; never sent to a model.">
								<UTextarea v-model="draft.creatorNotes" autoresize :rows="3" :maxrows="10" :maxlength="CHARACTER_TEXT_MAX" class="w-full" />
							</UFormField>
							<UFormField label="Tags" help="For you to sort by; never sent to a model.">
								<UInputTags v-model="draft.tags" placeholder="Add a tag" class="w-full" />
							</UFormField>
						</div>
					</template>
				</UTabs>
			</div>
		</template>
		<template #footer>
			<UButton color="neutral" variant="ghost" label="Cancel" @click="emit('close')" />
			<UButton label="Save" :disabled="!valid" @click="save" />
		</template>
	</UModal>
</template>
