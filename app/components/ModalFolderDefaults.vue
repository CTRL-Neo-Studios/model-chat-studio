<script setup lang="ts">
import type { FolderDefaults } from '#shared/utils/folderDefaults'

/** A folder's defaults for new chats started in it: libraries and a structure profile. */
const props = defineProps<{
	name: string
	defaults: FolderDefaults | null
	/** What a folder above would give when this one has none. */
	inherited: { from: string, defaults: FolderDefaults } | null
}>()

/** The new defaults (`null`: none of its own), or nothing when cancelled. */
const emit = defineEmits<{ close: [defaults?: FolderDefaults | null] }>()

const MAX_LIBRARIES = 5
const libraryIds = ref([...(props.defaults?.libraryIds ?? [])])
const structureProfileId = ref(props.defaults?.structureProfileId ?? null)

const { data: libraryList } = useQuery(librariesQuery)
const libraryItems = computed(() => (libraryList.value ?? []).map(library => ({
	label: library.name,
	value: library.id,
	disabled: libraryIds.value.length >= MAX_LIBRARIES && !libraryIds.value.includes(library.id),
})))
const { data: profileList } = useQuery(structureProfilesQuery)
const NONE = 'none'
const profileItems = computed(() => [
	{ label: 'None', value: NONE },
	...(profileList.value ?? []).map(profile => ({ label: profile.ownerId === null ? `${profile.name} (instance)` : profile.name, value: profile.id })),
])
const profileChoice = computed({
	get: () => structureProfileId.value ?? NONE,
	set: (value: string) => structureProfileId.value = value === NONE ? null : value,
})

const nameOf = (id: string) => libraryList.value?.find(library => library.id === id)?.name
const inheritedText = computed(() => {
	const inherited = props.inherited
	if (!inherited) return null
	const names = inherited.defaults.libraryIds.flatMap(id => nameOf(id) ?? [])
	const profile = profileList.value?.find(entry => entry.id === inherited.defaults.structureProfileId)?.name
	return `Without its own, it uses the defaults of “${inherited.from}”: ${names.length ? names.join(', ') : 'no libraries'}; structure profile ${profile ?? 'none'}.`
})

// Nothing chosen is no defaults of its own, so a folder above still gives its.
const empty = computed(() => !libraryIds.value.length && !structureProfileId.value)
</script>

<template>
	<UModal :title="`Defaults of “${name}”`" description="New chats started in this folder, or in a folder inside it without its own, begin with these. Chats already there keep what they have." :ui="{ footer: 'flex-row-reverse justify-start' }">
		<template #body>
			<div class="flex flex-col gap-4">
				<UFormField label="Libraries" :help="`At most ${MAX_LIBRARIES}.`">
					<USelectMenu v-model="libraryIds" :items="libraryItems" value-key="value" multiple placeholder="No library" icon="i-lucide-library-big" class="w-full" />
				</UFormField>
				<UFormField label="Structure profile">
					<USelect v-model="profileChoice" :items="profileItems" class="w-full" />
				</UFormField>
				<p v-if="inheritedText && !defaults" class="text-sm text-muted">
					{{ inheritedText }}
				</p>
			</div>
		</template>
		<template #footer>
			<UButton label="Save" @click="emit('close', empty ? null : { libraryIds, structureProfileId })" />
			<UButton color="neutral" variant="ghost" label="Cancel" @click="emit('close')" />
			<UButton v-if="defaults" color="neutral" variant="ghost" label="Remove defaults" class="me-auto" @click="emit('close', null)" />
		</template>
	</UModal>
</template>
