<script setup lang="ts">
import type { PackageItems } from '#shared/utils/package'

// A package's Items: the member's own Characters, libraries and structure profiles, within a listing's limits. Each
// change is saved at once; each item opens its page, which leads back here (`?package=`).
definePageMeta({ key: route => route.path })

const route = useRoute()
const packageId = route.params.id as string
const act = useApiAction()
const queryCache = useQueryCache()
const { user } = useUserSession()
const { data: found, error } = useQuery(() => packageQuery(packageId))
const { data: characters } = useQuery(charactersQuery)
const { data: libraries } = useQuery(librariesQuery)
const { data: profiles } = useQuery(structureProfilesQuery)
useHead({ title: () => found.value ? `${found.value.name}: items` : 'Package' })

const kinds = computed(() => [
	{ key: 'characterIds' as const, label: 'Characters', icon: 'i-lucide-drama', max: PACKAGE_LIMITS.characters, page: '/content/characters', own: (characters.value ?? []).filter(entry => entry.ownerId === user.value?.id) },
	{ key: 'libraryIds' as const, label: 'Libraries', icon: 'i-lucide-library-big', max: PACKAGE_LIMITS.libraries, page: '/content/libraries', own: (libraries.value ?? []).filter(entry => entry.role === 'owner') },
	{ key: 'structureProfileIds' as const, label: 'Structure profiles', icon: 'i-lucide-layers', max: PACKAGE_LIMITS.structureProfiles, page: '/content/structure-profiles', own: (profiles.value ?? []).filter(entry => entry.ownerId === user.value?.id) },
])
const nameOf = (kind: (typeof kinds.value)[number], id: string) => kind.own.find(entry => entry.id === id)?.name ?? ''

// Shown at once; back as it was if the server refuses.
async function setItems(key: keyof PackageItems, ids: string[]) {
	const before = found.value
	if (!before) return
	const items = { ...before.items, [key]: ids }
	queryCache.setQueryData(packageQuery(packageId).key, { ...before, items })
	if (await act(`/api/v1/packages/${packageId}`, { method: 'PATCH', body: { items } })) await queryCache.invalidateQueries({ key: packagesQuery.key, exact: true })
	else queryCache.setQueryData(packageQuery(packageId).key, before)
}
</script>

<template>
	<UDashboardPanel id="package-items" class="min-h-0">
		<template #header>
			<PageNavbar :current="found?.name" />
		</template>

		<template #body>
			<UError v-if="error" :error="{ statusMessage: 'Package not found', statusCode: 404 }" class="min-h-full" />
			<div v-else-if="found" class="w-full max-w-3xl mx-auto flex flex-col gap-6">
				<p class="text-sm text-muted">
					Your own items only: a library shared with you, or an instance Character, cannot be published. A setup's Characters and libraries come along without being added here.
				</p>
				<section v-for="kind in kinds" :key="kind.key" class="flex flex-col gap-2" :aria-labelledby="`items-${kind.key}`">
					<div class="flex items-center gap-2">
						<h2 :id="`items-${kind.key}`" class="font-semibold text-highlighted flex-1">
							{{ kind.label }} <span class="text-sm text-dimmed font-normal">{{ found.items[kind.key].length }} of {{ kind.max }}</span>
						</h2>
						<USelectMenu
							:model-value="found.items[kind.key]"
							:items="kind.own.map(entry => ({ label: entry.name, value: entry.id, disabled: found!.items[kind.key].length >= kind.max && !found!.items[kind.key].includes(entry.id) }))"
							value-key="value"
							multiple
							:placeholder="`Choose ${kind.label.toLowerCase()}`"
							:icon="kind.icon"
							class="w-64"
							:aria-label="`${kind.label} in the package`"
							@update:model-value="(ids: string[]) => setItems(kind.key, ids)"
						/>
					</div>
					<p v-if="!found.items[kind.key].length" class="text-sm text-dimmed">
						None.
					</p>
					<ul v-else class="flex flex-col divide-y divide-default rounded-md border border-default">
						<li v-for="id in found.items[kind.key]" :key="id" class="flex items-center gap-3 px-3 py-2">
							<UIcon :name="kind.icon" class="size-4 text-muted shrink-0" />
							<NuxtLink :to="{ path: `${kind.page}/${id}`, query: { package: packageId } }" class="text-sm text-highlighted truncate flex-1 hover:text-primary">
								{{ nameOf(kind, id) }}
							</NuxtLink>
							<UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" :aria-label="`Take ${nameOf(kind, id)} out`" @click="setItems(kind.key, found.items[kind.key].filter(other => other !== id))" />
						</li>
					</ul>
				</section>
			</div>
			<div v-else class="w-full max-w-3xl mx-auto flex flex-col gap-4" aria-busy="true" aria-label="Loading the package">
				<USkeleton v-for="n in 3" :key="n" class="h-20 w-full" />
			</div>
		</template>
	</UDashboardPanel>
</template>
