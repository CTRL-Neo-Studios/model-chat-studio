<script setup lang="ts">
import { LANE_COLORS } from '#shared/utils/chat'
import { CHARACTER_TEXT_MAX, type CharacterFields, characterAvatarUrl } from '#shared/utils/character'

// One Character, edited section by section (`?section=`, listed by its sidebar); `new` makes one (`?instance=1`: an
// admin's instance Character). Keyed by the address, so opening another Character starts afresh.
definePageMeta({ key: route => route.path })

const route = useRoute()
const creating = route.params.id === 'new'
const act = useApiAction()
const toast = useToast()
const queryCache = useQueryCache()
const { user } = useUserSession()
const { data: characters, isPending } = useQuery(charactersQuery)
type Character = NonNullable<typeof characters.value>[number]
const character = computed(() => characters.value?.find(entry => entry.id === route.params.id))
useHead({ title: () => character.value?.name ?? (creating ? 'New Character' : 'Character') })

const isAdmin = computed(() => user.value?.role === 'admin')
const instance = computed(() => creating ? route.query.instance === '1' : character.value?.ownerId === null)
// An instance Character is the admins' to change; members read it.
const canEdit = computed(() => !instance.value || isAdmin.value)
const section = computed(() => characterSectionOf(route.query.section))

const blank: CharacterFields = { name: '', color: null, instructions: '', libraryIds: [], greetings: [], examples: '', note: '', creatorNotes: '', tags: [] }
const fieldsOf = ({ name, color, instructions, libraryIds, greetings, examples, note, creatorNotes, tags }: Character): CharacterFields => ({ name, color, instructions, libraryIds, greetings, examples, note, creatorNotes, tags })
const store = (saved: Character) => queryCache.setQueryData(charactersQuery.key, (list = []) => list.some(entry => entry.id === saved.id) ? list.map(entry => entry.id === saved.id ? saved : entry) : [...list, saved])

// The draft, and the fields as last saved, to tell what changed.
const draft = ref<CharacterFields | undefined>(creating ? structuredClone(blank) : undefined)
const saved = ref(creating ? JSON.stringify(blank) : '')
watch(character, (value) => {
	if (draft.value || !value) return
	draft.value = fieldsOf(value)
	saved.value = JSON.stringify(draft.value)
}, { immediate: true })

// The avatar: a picked image shows at once; it is uploaded when the Character is saved.
const avatarFile = ref<File | null>()
const avatarPreview = ref<string>()
const avatar = computed(() => character.value && characterAvatarUrl(character.value))
const avatarShown = computed(() => avatarFile.value === null ? undefined : avatarPreview.value ?? avatar.value)
const picker = ref<HTMLInputElement>()
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
	avatarFile.value = avatar.value ? null : undefined
}
onBeforeUnmount(() => avatarPreview.value && URL.revokeObjectURL(avatarPreview.value))

const dirty = computed(() => !!draft.value && (JSON.stringify(draft.value) !== saved.value || avatarFile.value !== undefined))
const valid = computed(() => !!draft.value?.name.trim() && draft.value.greetings.every(greeting => greeting.trim()))
useUnsavedGuard(() => dirty.value)

const saving = ref(false)
async function save() {
	if (!draft.value || !valid.value) return
	const fields = { ...draft.value, name: draft.value.name.trim() }
	saving.value = true
	const result = creating
		? await act<Character>('/api/v1/characters', { method: 'POST', body: { ...fields, instance: instance.value || undefined }, success: 'Character added' })
		: await act<Character>(`/api/v1/characters/${route.params.id}`, { method: 'PATCH', body: fields, success: 'Character saved' })
	if (result) {
		store(result)
		// The avatar goes once the Character exists: a new image, or `null` to remove it.
		if (avatarFile.value !== undefined) {
			const form = new FormData()
			if (avatarFile.value) form.append('file', avatarFile.value)
			const withAvatar = await act<Character>(`/api/v1/characters/${result.id}/avatar`, avatarFile.value ? { method: 'PUT', body: form } : { method: 'DELETE' })
			if (withAvatar) store(withAvatar)
			if (avatarPreview.value) URL.revokeObjectURL(avatarPreview.value)
			avatarPreview.value = undefined
			avatarFile.value = undefined
		}
		draft.value = fields
		saved.value = JSON.stringify(fields)
		if (creating) await navigateTo({ path: `/content/characters/${result.id}`, query: { section: section.value } }, { replace: true })
	}
	saving.value = false
}

const colorItems = [
	{ label: 'No color', value: null, swatch: 'border border-dashed border-accented' },
	...LANE_COLORS.map(color => ({ label: color.charAt(0).toUpperCase() + color.slice(1), value: color, swatch: LANE_COLOR_CLASSES[color] })),
]
const MAX_LIBRARIES = 5
const { data: libraryList } = useQuery(librariesQuery)
const libraryItems = computed(() => (libraryList.value ?? []).map(library => ({
	label: library.name,
	value: library.id,
	disabled: (draft.value?.libraryIds.length ?? 0) >= MAX_LIBRARIES && !draft.value?.libraryIds.includes(library.id),
})))
const chosenLibraries = computed(() => (draft.value?.libraryIds ?? []).flatMap(id => (libraryList.value ?? []).filter(library => library.id === id)))
const tokens = (text: string) => Math.ceil(text.length / 4).toLocaleString('en-US')
</script>

<template>
	<UDashboardPanel id="character" class="min-h-0">
		<template #header>
			<PageNavbar :current="character?.name ?? (creating ? 'New Character' : '')">
				<template #right>
					<UBadge v-if="dirty" label="Not saved" color="warning" variant="subtle" />
					<UButton v-if="canEdit" label="Save" icon="i-lucide-check" :loading="saving" :disabled="!dirty || !valid" @click="save" />
				</template>
			</PageNavbar>
		</template>

		<template #body>
			<UError v-if="!creating && !isPending && !character" :error="{ statusMessage: 'Character not found', statusCode: 404 }" class="min-h-full" />
			<!-- A disabled fieldset turns every field into reading only. -->
			<fieldset v-else-if="draft" :disabled="!canEdit" class="w-full max-w-3xl mx-auto flex flex-col gap-5 min-w-0">
				<UAlert v-if="!canEdit" color="neutral" variant="subtle" icon="i-lucide-building" title="An instance Character" description="Admins keep it; you can use it in chats, or copy it to your Characters from the list." />
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
					<UInput v-model="draft.name" placeholder="Name, e.g. Engineer" :maxlength="60" size="lg" class="flex-1" aria-label="Name" />
				</div>

				<h2 class="font-semibold text-highlighted">
					{{ CHARACTER_SECTIONS.find(entry => entry.value === section)!.label }}
				</h2>

				<UFormField v-if="section === 'instructions'" :help="`About ${tokens(draft.instructions)} tokens. They take the place of the system prompt. {{char}} is this Character's name, {{user}} the user's.`">
					<UTextarea v-model="draft.instructions" autoresize :rows="10" :maxrows="30" :maxlength="CHARACTER_TEXT_MAX" placeholder="e.g. You are {{char}}, a senior engineer. Explain trade-offs to {{user}} plainly." class="w-full" aria-label="Instructions" />
				</UFormField>

				<div v-else-if="section === 'greetings'" class="flex flex-col gap-3">
					<p class="text-sm text-muted">
						A chat started with this Character opens with the first greeting, as its first answer; the others are versions of it to flip to.
					</p>
					<div v-for="(_, index) in draft.greetings" :key="index" class="flex items-start gap-2">
						<UTextarea v-model="draft.greetings[index]" autoresize :rows="2" :maxrows="10" :maxlength="CHARACTER_TEXT_MAX" :placeholder="index ? 'Another greeting' : 'e.g. *{{char}} looks up from the map.* You made it, {{user}}.'" :aria-label="`Greeting ${index + 1}`" class="flex-1" />
						<UButton icon="i-lucide-x" color="neutral" variant="ghost" :aria-label="`Remove greeting ${index + 1}`" @click="draft.greetings.splice(index, 1)" />
					</div>
					<UButton icon="i-lucide-plus" :label="draft.greetings.length ? 'Add another greeting' : 'Add a greeting'" color="neutral" variant="outline" class="self-start" :disabled="draft.greetings.length >= 50" @click="draft.greetings.push('')" />
				</div>

				<div v-else-if="section === 'examples'" class="flex flex-col gap-4">
					<UFormField label="Example dialogue" :help="`Sent after the instructions, as written: how {{char}} talks. About ${tokens(draft.examples)} tokens.`">
						<UTextarea v-model="draft.examples" autoresize :rows="6" :maxrows="20" :maxlength="CHARACTER_TEXT_MAX" placeholder="{{user}}: Is it safe?&#10;{{char}}: Safe enough, if you keep to the path." class="w-full" />
					</UFormField>
					<UFormField label="Closing note" :help="`Sent after the conversation on every turn, as a reminder: style, length, what to keep in mind. About ${tokens(draft.note)} tokens.`">
						<UTextarea v-model="draft.note" autoresize :rows="3" :maxrows="10" :maxlength="CHARACTER_TEXT_MAX" placeholder="e.g. Stay in character. Keep answers under three paragraphs." class="w-full" />
					</UFormField>
				</div>

				<div v-else-if="section === 'lorebook'" class="flex flex-col gap-3">
					<UFormField label="Libraries" :help="`Read by this Character's model only, in every chat it joins. At most ${MAX_LIBRARIES}.`">
						<USelectMenu v-model="draft.libraryIds" :items="libraryItems" value-key="value" multiple placeholder="No library" icon="i-lucide-library-big" class="w-full" />
					</UFormField>
					<div v-if="chosenLibraries.length" class="flex flex-wrap gap-2">
						<UButton v-for="library in chosenLibraries" :key="library.id" :to="`/content/libraries/${library.id}`" :label="library.name" icon="i-lucide-library-big" color="neutral" variant="subtle" size="xs" />
					</div>
				</div>

				<div v-else class="flex flex-col gap-4">
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
			</fieldset>
			<div v-else class="w-full max-w-3xl mx-auto flex flex-col gap-4" aria-busy="true" aria-label="Loading the Character">
				<USkeleton class="h-10 w-full" />
				<USkeleton class="h-48 w-full" />
			</div>
		</template>
	</UDashboardPanel>
</template>
