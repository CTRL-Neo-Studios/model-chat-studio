<script setup lang="ts">
import type { ChatSettings, NewLane } from '#shared/utils/chat'
import type { FolderDefaults } from '#shared/utils/folderDefaults'

/**
 * A chat setup as a folder's defaults: what a new chat started in the folder (or in a package's folder) begins with.
 * Every field is optional: what is left unset starts as the home page does. `result` is the setup as chosen, `null`
 * when nothing is.
 */
const props = defineProps<{
	defaults: FolderDefaults | null
	/** What a folder above would give when this one has none. */
	inherited?: { from: string, defaults: FolderDefaults } | null
}>()
const result = defineModel<FolderDefaults | null>('result')

const MAX_LIBRARIES = 5
const UNSET = 'unset'
const NONE = 'none'
const libraryIds = ref([...(props.defaults?.libraryIds ?? [])])
const structureProfileId = ref(props.defaults?.structureProfileId ?? null)
const models = ref<NewLane[]>(structuredClone(toRaw(props.defaults?.models ?? [])))
const mode = ref<string>(props.defaults?.mode ?? UNSET)
const userCharacter = ref<string>(props.defaults?.userCharacterId === undefined ? UNSET : props.defaults.userCharacterId ?? NONE)
// Web search is set here; the other chat settings come from "Use this chat's setup" and are kept as they are.
const { webSearch, ...otherSettings } = props.defaults?.settings ?? {}
const webSearchChoice = ref<string>(webSearch === undefined ? UNSET : webSearch ? 'on' : 'off')

const { data: libraryList } = useQuery(librariesQuery)
const libraryItems = computed(() => (libraryList.value ?? []).map(library => ({
	label: library.name,
	value: library.id,
	disabled: libraryIds.value.length >= MAX_LIBRARIES && !libraryIds.value.includes(library.id),
})))
const { data: structureList } = useQuery(structureProfilesQuery)
const structureItems = computed(() => [
	{ label: 'None', value: NONE },
	...(structureList.value ?? []).map(profile => ({ label: profile.ownerId === null ? `${profile.name} (instance)` : profile.name, value: profile.id })),
])
const structureChoice = computed({
	get: () => structureProfileId.value ?? NONE,
	set: (value: string) => structureProfileId.value = value === NONE ? null : value,
})

// Models: the lanes a new chat starts with, by profile or by their own fields.
const { data: modelProfiles } = useQuery(modelProfilesQuery)
const { data: characters } = useQuery(charactersQuery)
const { resolveModel } = useModels()
const laneLabel = (lane: NewLane) => characters.value?.find(character => character.id === lane.characterId)?.name
	?? lane.name
	?? modelProfiles.value?.find(profile => profile.id === lane.profileId)?.name
	?? resolveModel(lane.modelId ?? undefined)?.name
	?? 'Default model'
const profileItems = computed(() => (modelProfiles.value ?? []).map(profile => ({ label: profile.ownerId === null ? `${profile.name} (instance)` : profile.name, value: profile.id })))
const addProfile = (profileId: string) => {
	if (profileId && models.value.length < 12) models.value = [...models.value, { profileId }]
}
const modeItems = computed(() => [
	{ label: 'Not set', value: UNSET },
	{ label: 'Separate answers', value: 'separate' },
	{ label: 'Group chat', value: 'group', disabled: models.value.length < 2 },
])
const characterItems = computed(() => [
	{ label: 'Not set: your default from Settings', value: UNSET },
	{ label: 'Nobody', value: NONE },
	...(characters.value ?? []).map(character => ({ label: character.ownerId === null ? `${character.name} (instance)` : character.name, value: character.id })),
])
const onOffItems = [{ label: 'Not set', value: UNSET }, { label: 'On', value: 'on' }, { label: 'Off', value: 'off' }]

const chosen = computed((): FolderDefaults | null => {
	const settings: ChatSettings = { ...otherSettings, ...(webSearchChoice.value !== UNSET && { webSearch: webSearchChoice.value === 'on' }) }
	const chosenMode = mode.value === 'group' && models.value.length < 2 ? UNSET : mode.value
	const defaults: FolderDefaults = {
		libraryIds: libraryIds.value,
		structureProfileId: structureProfileId.value,
		...(models.value.length && { models: models.value }),
		...(chosenMode !== UNSET && { mode: chosenMode as 'separate' | 'group' }),
		...(userCharacter.value !== UNSET && { userCharacterId: userCharacter.value === NONE ? null : userCharacter.value }),
		...(Object.keys(settings).length && { settings }),
	}
	// Nothing chosen is no defaults of its own, so a folder above still gives its.
	return Object.keys(defaults).length === 2 && !defaults.libraryIds.length && !defaults.structureProfileId ? null : defaults
})
watch(chosen, value => result.value = value, { immediate: true })

const inheritedText = computed(() => {
	const inherited = props.inherited
	if (!inherited || props.defaults) return null
	const { libraryIds: ids, structureProfileId: profileId, models: lanes, mode: inheritedMode } = inherited.defaults
	const names = ids.flatMap(id => libraryList.value?.find(library => library.id === id)?.name ?? [])
	const profile = structureList.value?.find(entry => entry.id === profileId)?.name
	const parts = [
		names.length ? `libraries ${names.join(', ')}` : '',
		profile ? `structure profile ${profile}` : '',
		lanes?.length ? `models ${lanes.map(laneLabel).join(', ')}` : '',
		inheritedMode === 'group' ? 'a group chat' : '',
	].filter(Boolean)
	return `Without its own, it uses the defaults of “${inherited.from}”${parts.length ? `: ${parts.join('; ')}` : ''}.`
})
</script>

<template>
	<div class="flex flex-col gap-4">
		<UFormField label="Models" help="A new chat starts with these, in this order. None: the models of your last chat.">
			<div class="flex flex-col gap-2">
				<div v-for="(lane, index) in models" :key="index" class="flex items-center gap-2 rounded-md border border-default px-3 py-1.5">
					<UIcon name="i-lucide-bot" class="size-4 text-muted shrink-0" />
					<span class="text-sm flex-1 truncate">{{ laneLabel(lane) }}</span>
					<UButton icon="i-lucide-x" color="neutral" variant="ghost" size="xs" :aria-label="`Remove ${laneLabel(lane)}`" @click="models = models.toSpliced(index, 1)" />
				</div>
				<!-- Keyed by the count, so after each pick it shows its placeholder again. -->
				<USelectMenu
					:key="models.length"
					:model-value="undefined"
					:items="profileItems"
					value-key="value"
					placeholder="Add a model profile"
					icon="i-lucide-plus"
					:disabled="models.length >= 12"
					class="w-full"
					@update:model-value="addProfile"
				/>
			</div>
		</UFormField>
		<UFormField label="Answers">
			<USelect v-model="mode" :items="modeItems" class="w-full" />
		</UFormField>
		<UFormField label="You are">
			<USelect v-model="userCharacter" :items="characterItems" class="w-full" />
		</UFormField>
		<UFormField label="Web search">
			<USelect v-model="webSearchChoice" :items="onOffItems" class="w-full" />
		</UFormField>
		<p v-if="Object.keys(otherSettings).length" class="text-sm text-muted">
			Other chat settings (memory, layout, file tools, auto-fetch) come from the chat they were copied from and are kept.
		</p>
		<UFormField label="Libraries" :help="`At most ${MAX_LIBRARIES}.`">
			<USelectMenu v-model="libraryIds" :items="libraryItems" value-key="value" multiple placeholder="No library" icon="i-lucide-library-big" class="w-full" />
		</UFormField>
		<UFormField label="Structure profile">
			<USelect v-model="structureChoice" :items="structureItems" class="w-full" />
		</UFormField>
		<p v-if="inheritedText" class="text-sm text-muted">
			{{ inheritedText }}
		</p>
	</div>
</template>
