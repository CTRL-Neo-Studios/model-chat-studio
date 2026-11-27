<script setup lang="ts">
import type { FolderDefaults } from '#shared/utils/folderDefaults'

// A package's Setup: the chat it starts, as a folder's defaults (`FolderDefaultsForm`). Whoever gets the package gets
// a folder with it. Saved with "Save"; leaving with changes asks.
definePageMeta({ key: route => route.path })

const route = useRoute()
const packageId = route.params.id as string
const act = useApiAction()
const queryCache = useQueryCache()
const { found, error, listing } = usePackage(packageId)
useHead({ title: () => found.value ? `${found.value.name}: setup` : 'Package' })

// The setup as chosen, and as last saved (the form's first value), to tell what changed.
const result = ref<FolderDefaults | null>(null)
const saved = ref<string>()
watch(result, value => saved.value ??= JSON.stringify(value))
const dirty = computed(() => saved.value !== undefined && JSON.stringify(result.value) !== saved.value)
useUnsavedGuard(() => dirty.value)
// Bumped to start the form afresh from what is stored (after "Remove setup").
const formKey = ref(0)

const saving = ref(false)
async function save(setup: FolderDefaults | null) {
	saving.value = true
	const stored = await act<NonNullable<typeof found.value>>(`/api/v1/packages/${packageId}`, { method: 'PATCH', body: { setup }, success: setup ? 'Setup saved' : 'Setup removed' })
	saving.value = false
	if (!stored) return
	queryCache.setQueryData(packageQuery(packageId).key, { ...found.value!, setup: stored.setup })
	await queryCache.invalidateQueries({ key: packagesQuery.key, exact: true })
	if (setup) saved.value = JSON.stringify(result.value)
	else {
		saved.value = undefined
		formKey.value++
	}
}
</script>

<template>
	<UDashboardPanel id="package-setup" class="min-h-0">
		<template #header>
			<PageNavbar :current="found?.name">
				<template #right>
					<UBadge v-if="dirty" label="Not saved" color="warning" variant="subtle" />
					<UButton v-if="found?.setup" label="Remove setup" color="neutral" variant="ghost" :disabled="saving" @click="save(null)" />
					<UButton label="Save" icon="i-lucide-check" :loading="saving" :disabled="!dirty" @click="save(result)" />
				</template>
			</PageNavbar>
		</template>

		<template #body>
			<UError v-if="error" :error="{ statusMessage: 'Package not found', statusCode: 404 }" class="min-h-full" />
			<div v-else-if="found" class="w-full max-w-2xl mx-auto flex flex-col gap-4">
				<p class="text-sm text-muted">
					The chat this package starts. Whoever gets it gets a folder with this setup, and new chats there begin with it. The Characters, libraries and structure profile it names come along when they are yours.{{ listing ? ' Changes reach Explore with the next update.' : '' }}
				</p>
				<FolderDefaultsForm :key="formKey" v-model:result="result" :defaults="found.setup" />
			</div>
			<div v-else class="w-full max-w-2xl mx-auto flex flex-col gap-4" aria-busy="true" aria-label="Loading the package">
				<USkeleton v-for="n in 4" :key="n" class="h-12 w-full" />
			</div>
		</template>
	</UDashboardPanel>
</template>
